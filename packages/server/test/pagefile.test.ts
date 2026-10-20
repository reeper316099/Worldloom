import { describe, expect, it } from 'vitest';
import { parsePageFile, serializePage } from '../src/pagefile';

const page = { id: 'p1', type: 'character', title: 'A', slug: 'a', aliases: [], status: 'draft' as const, tags: [], categories: [], fields: {}, appliesTo: 'all' as const, dmOnly: false, createdAt: 'x', updatedAt: 'y', body: '{{infobox}}\n\nFirst paragraph.\n\nSecond.\n' };

describe('page files', () => {
  it('round-trips', () => expect(parsePageFile(serializePage(page)).body).toBe(page.body));
  it('treats CRLF checkouts (Windows autocrlf) exactly like LF', () => {
    const crlf = serializePage(page).replace(/\n/g, '\r\n');
    const parsed = parsePageFile(crlf);
    expect(parsed.body).toBe(page.body);
    expect(parsed.title).toBe('A');
  });
});
