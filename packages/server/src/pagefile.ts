import YAML from 'yaml';
import { PageMetaSchema, type Page } from '@worldloom/shared';

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export class PageFileError extends Error {
  constructor(
    message: string,
    public line?: number,
  ) {
    super(message);
  }
}

/** Parse a page .md file (YAML frontmatter + Markdown body). */
export function parsePageFile(text: string): Page {
  const m = FM.exec(text);
  if (!m) throw new PageFileError('missing frontmatter', 1);
  let raw: unknown;
  try {
    raw = YAML.parse(m[1]!);
  } catch (e) {
    const line = (e as { linePos?: Array<{ line: number }> }).linePos?.[0]?.line;
    throw new PageFileError(`invalid YAML: ${(e as Error).message.split('\n')[0]}`, line ? line + 1 : undefined);
  }
  const parsed = PageMetaSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    throw new PageFileError(`invalid frontmatter at ${i.path.join('.') || '(root)'}: ${i.message}`);
  }
  return { ...parsed.data, body: text.slice(m[0].length).replace(/^\r?\n/, '') };
}

const KEY_ORDER = ['id', 'type', 'title', 'slug', 'aliases', 'redirectsTo', 'status', 'tags', 'categories', 'appliesTo', 'reveal', 'dmOnly', 'fields', 'createdAt', 'updatedAt'];

export function serializePage(p: Page): string {
  const { body, ...meta } = p;
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) {
    const v = (meta as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0 && k !== 'aliases') continue;
    if (k === 'dmOnly' && v === false) continue;
    ordered[k] = v;
  }
  return `---\n${YAML.stringify(ordered, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.replace(/^\n+/, '')}${body.endsWith('\n') || body === '' ? '' : '\n'}`;
}
