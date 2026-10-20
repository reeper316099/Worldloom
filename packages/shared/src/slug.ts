/** Lowercase, ascii-ish, hyphenated slug. Falls back to "untitled". */
export function slugify(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return s || 'untitled';
}

/** Normalised key for case/space-insensitive title & alias lookup. */
export function titleKey(input: string): string {
  return input.trim().replace(/[\s_]+/g, ' ').toLowerCase();
}
