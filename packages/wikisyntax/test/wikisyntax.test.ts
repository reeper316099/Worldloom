import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractLinks, rewriteLinks, extractSection, render, redact, parseLinkInner, formatLink } from '../src';

describe('links', () => {
  it('parses all link forms', () => {
    const ls = extractLinks('[[A]] [[A|label]] [[A#Sec]] [[type:Character/Bob#Hist|him]] [[#Local]]');
    expect(ls.map((l) => [l.name, l.label, l.section, l.type])).toEqual([
      ['A', undefined, undefined, undefined],
      ['A', 'label', undefined, undefined],
      ['A', undefined, 'Sec', undefined],
      ['Bob', 'him', 'Hist', 'Character'],
      ['', undefined, 'Local', undefined],
    ]);
  });
  it('ignores code', () => {
    expect(extractLinks('`[[a]]`\n```\n[[b]]\n```\n[[c]]').map((l) => l.name)).toEqual(['c']);
  });
  it('rewrites only matching, preserving label/section, never code', () => {
    const src = '[[Old|x]] [[Old#S]] `[[Old]]` [[Other]]\n```\n[[Old]]\n```';
    const r = rewriteLinks(src, (l) => (l.name === 'Old' ? { name: 'New' } : undefined));
    expect(r.source).toBe('[[New|x]] [[New#S]] `[[Old]]` [[Other]]\n```\n[[Old]]\n```');
    expect(r.changed).toBe(2);
  });
  it('property: rewrite then extract sees new names, offsets stay valid', () => {
    const name = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,10}[A-Za-z]$/);
    fc.assert(
      fc.property(fc.array(name, { minLength: 1, maxLength: 5 }), name, (names, to) => {
        const src = names.map((n) => `text [[${n}]] more`).join('\n');
        const r = rewriteLinks(src, () => ({ name: to }));
        const found = extractLinks(r.source).map((l) => l.name);
        return found.length === names.length && found.every((n) => n === to);
      }),
    );
  });
  it('property: format/parse roundtrip', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}$/), fc.option(fc.stringMatching(/^[A-Za-z]{1,8}$/), { nil: undefined }), (name, label) => {
        const p = parseLinkInner(formatLink({ name, label }).slice(2, -2))!;
        return p.name === name.trim() && p.label === label;
      }),
    );
  });
  it('extracts sections', () => {
    const s = '# T\nintro\n## A\nalpha\n### A1\nsub\n## B\nbeta';
    expect(extractSection(s, 'A')).toBe('alpha\n### A1\nsub');
    expect(extractSection(s, 'zzz')).toBeUndefined();
  });
});

describe('render', () => {
  const opts = { resolveLink: (l: { name: string }) => ({ href: `#/${l.name}`, exists: l.name !== 'Missing' }) };
  it('renders links incl. red links', () => {
    const r = render('See [[Alice]] and [[Missing|nobody]].', opts);
    expect(r.html).toContain('<a href="#/Alice" class="wikilink" data-target="Alice">Alice</a>');
    expect(r.html).toContain('redlink');
    expect(r.links.map((l) => l.name)).toEqual(['Alice', 'Missing']);
  });
  it('renders citations and claims', () => {
    const r = render('{{claim: theory}}He is a fox {{src: WN ch 3}}{{/claim}} and {{claim: confirmed}}ok{{/claim}}', {
      resolveCitation: (t) => ({ label: `Web Novel · ${t}`, sourceId: 'wn' }),
    });
    expect(r.html).toContain('class="cite"');
    expect(r.html).toContain('claim-theory');
    expect(r.claims).toEqual([
      { kind: 'theory', text: 'He is a fox Web Novel · WN ch 3', cited: true },
      { kind: 'confirmed', text: 'ok', cited: false },
    ]);
  });
  it('drops unbalanced claim markers safely', () => {
    expect(render('a {{claim: theory}} b').html).not.toContain('mark');
    expect(render('a {{/claim}} b').html).toContain('a');
  });
  it('toc, infobox and embeds', () => {
    const r = render('{{toc}}\n\n{{infobox}}\n\n{{embed: X#Y}}\n\n# One\n## Two', {
      infobox: () => '<aside class="infobox">I</aside>',
      embed: () => '<p>embedded</p>',
    });
    expect(r.html).toContain('<nav class="toc">');
    expect(r.html).toContain('href="#h-one"');
    expect(r.html).toContain('<aside class="infobox">I</aside>');
    expect(r.html).toContain('<p>embedded</p>');
    expect(r.html).toContain('id="h-two"');
  });
  it('continuity blocks filter', () => {
    const src = ':::continuity{ids="wn"}\nWN only\n:::\n\n:::continuity{ids="ln"}\nLN only\n:::';
    expect(render(src, { continuity: 'wn' }).html).toContain('WN only');
    expect(render(src, { continuity: 'wn' }).html).not.toContain('LN only');
    const all = render(src).html;
    expect(all).toContain('WN only');
    expect(all).toContain('LN only');
  });
  it('spoiler content is removed (not hidden) when gated', () => {
    const src = 'before\n\n:::spoiler{src="wn" at=120}\nSECRET [[Villain]]\n:::\n\nafter';
    const r = render(src, { isRevealed: () => false, ...opts });
    expect(r.html).not.toContain('SECRET');
    expect(r.html).not.toContain('Villain');
    expect(r.html).toContain('Spoiler for wn 120');
    expect(r.links).toEqual([]);
    expect(r.hiddenBlocks).toHaveLength(1);
    expect(render(src, { isRevealed: () => true }).html).toContain('SECRET');
  });
  it('redact removes hidden blocks for indexing', () => {
    const src = 'a [[One]]\n\n:::spoiler{src="wn" at=5}\n[[Two]] SECRET\n:::\n\nb [[Three]]';
    const red = redact(src, { isRevealed: () => false });
    expect(red).not.toContain('SECRET');
    expect(extractLinks(red).map((l) => l.name)).toEqual(['One', 'Three']);
  });
  it('XSS payloads are inert', () => {
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[x](javascript:alert(1))',
      '<a href="javascript:alert(1)">x</a>',
      '[[<script>alert(1)</script>]]',
      '{{src: <img src=x onerror=alert(1)>}}',
      '<svg onload=alert(1)>',
      '<iframe src="http://evil"></iframe>',
      '<div onclick="x()">hi</div>',
    ];
    for (const p of payloads) {
      const { html } = render(p, { resolveLink: (l) => ({ href: '#/' + l.name, exists: true }) });
      expect(html).not.toMatch(/<script|<img|<svg|<iframe|onerror|onload|onclick|javascript:/i);
    }
  });
  it('malformed input does not throw', () => {
    for (const s of ['[[', ']]', '{{', '{{claim: }}', ':::spoiler', ':::\n:::', '[[|]]', '[[#]]', 'x:::y', 'a :foo b']) {
      expect(() => render(s)).not.toThrow();
    }
    expect(render('time 10:30 note:foo').html).toContain('10:30 note:foo');
  });
  it('property: render never throws on arbitrary input', () => {
    fc.assert(fc.property(fc.string(), (s) => typeof render(s).html === 'string'), { numRuns: 200 });
  });
});
