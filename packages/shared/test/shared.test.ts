import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { APP_NAME, isVisible, slugify, ProgressSchema, type Arc, type Source } from '../src';

const arcs: Arc[] = [
  { id: 'a1', name: 'One', order: 1, ranges: { wn: { from: 1, to: 50 }, an: { from: 1, to: 5 } }, summary: '' },
  { id: 'a2', name: 'Two', order: 2, ranges: { wn: { from: 51, to: 100 }, an: { from: 6, to: 10 } }, summary: '' },
];
const sources = [] as Source[];
const ctx = (p: object) => ({ progress: ProgressSchema.parse(p), arcs, sources, primarySourceIds: ['wn'] });

describe('shared', () => {
  it('has APP_NAME', () => expect(APP_NAME).toBe('Worldloom'));
  it('slugify', () => {
    expect(slugify('Héllo, World!')).toBe('hello-world');
    expect(slugify('***')).toBe('untitled');
  });
  it('unknown progress is hidden', () => {
    expect(isVisible([{ sourceId: 'wn', at: 1 }], ctx({}))).toBe(false);
    expect(isVisible([], ctx({}))).toBe(true);
  });
  it('source gate is inclusive', () => {
    expect(isVisible([{ sourceId: 'wn', at: 10 }], ctx({ sources: { wn: 10 } }))).toBe(true);
    expect(isVisible([{ sourceId: 'wn', at: 10 }], ctx({ sources: { wn: 9 } }))).toBe(false);
  });
  it('all ancestors must pass', () => {
    const c = ctx({ sources: { wn: 10 } });
    expect(isVisible([{ sourceId: 'wn', at: 5 }, { sourceId: 'wn', at: 20 }], c)).toBe(false);
  });
  it('showAll and per-item override', () => {
    const g = [{ sourceId: 'wn', at: 99 }];
    expect(isVisible(g, ctx({ showAll: true }))).toBe(true);
    expect(isVisible(g, ctx({ revealed: ['k'] }), 'k')).toBe(true);
    expect(isVisible(g, ctx({ revealed: ['k'] }), 'z')).toBe(false);
  });
  it('arc checkpoint implies floors conservatively', () => {
    const c = ctx({ arcCheckpoint: 'a1' });
    expect(isVisible([{ sourceId: 'wn', at: 50 }], c)).toBe(true); // primary: range.to
    expect(isVisible([{ sourceId: 'an', at: 5 }], c)).toBe(false); // non-primary: range.from only
    expect(isVisible([{ sourceId: 'an', at: 1 }], c)).toBe(true);
    expect(isVisible([{ arcId: 'a1' }], c)).toBe(true);
    expect(isVisible([{ arcId: 'a2' }], c)).toBe(false);
  });
  it('property: raising progress never hides content', () => {
    fc.assert(
      fc.property(fc.nat(200), fc.nat(200), fc.nat(200), (at, p, extra) => {
        const g = [{ sourceId: 'wn', at }];
        const lo = isVisible(g, ctx({ sources: { wn: p } }));
        const hi = isVisible(g, ctx({ sources: { wn: p + extra } }));
        return !lo || hi;
      }),
    );
  });
});
