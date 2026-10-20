import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from '@worldloom/jsonstore';
import { badRequest, notFound } from './errors';

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const FILE_RE = /^[a-f0-9]{16,64}\.(png|jpg|gif|webp|svg)$/;

function sniff(b: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | undefined {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return 'gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return undefined;
}

/** SVGs are rejected (not rewritten) if they contain anything scriptable or remote. */
export function assertSafeSvg(text: string) {
  const bad = /<\s*(script|foreignObject|iframe|object|embed|image|use|a)\b|\son[a-z]+\s*=|javascript:|data:text|<!ENTITY|<!DOCTYPE|(?:xlink:)?href\s*=\s*["']?(?!#)|url\(\s*["']?(?!#)|@import/i;
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) throw badRequest('not an SVG document');
  if (bad.test(text)) throw badRequest('SVG contains disallowed content (scripts, external references, or embedded objects)');
}

export async function storeAsset(dir: string, data: Buffer, declared?: string): Promise<{ file: string; bytes: number }> {
  if (!data.length) throw badRequest('empty upload');
  if (data.length > MAX_ASSET_BYTES) throw badRequest('file too large (max 10 MB)');
  let ext = sniff(data);
  if (!ext) {
    if (declared?.includes('svg') || data.subarray(0, 512).toString('utf8').includes('<svg')) {
      assertSafeSvg(data.toString('utf8'));
      ext = 'svg' as never;
    } else throw badRequest('unsupported image type (png, jpg, gif, webp, svg)');
  }
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
  const file = `${hash}.${ext}`;
  await atomicWrite(path.join(dir, file), data);
  return { file, bytes: data.length };
}

export async function readAsset(dir: string, name: string): Promise<{ data: Buffer; type: string }> {
  if (!FILE_RE.test(name)) throw notFound('asset');
  const full = path.resolve(dir, name);
  if (path.dirname(full) !== path.resolve(dir)) throw notFound('asset');
  try {
    const data = await fs.readFile(full);
    const ext = name.split('.').pop()!;
    return { data, type: ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
  } catch {
    throw notFound('asset');
  }
}
