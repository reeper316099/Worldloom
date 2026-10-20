import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, createAesCodec, isEncrypted, stableStringify, type Codec } from '@worldloom/jsonstore';
import { parsePageFile } from './pagefile';

export interface CryptoMeta {
  format: 'worldloom-crypto';
  version: 1;
  /** Shown while locked instead of the (encrypted) world name. */
  label: string;
  /** 'encrypting' / 'decrypting' mark an interrupted migration; unlocking finishes it. */
  state: 'ready' | 'encrypting' | 'decrypting';
  kdf: { name: 'scrypt'; salt: string; N: number; r: number; p: number };
  wrapped: { iv: string; tag: string; ct: string };
}

export const CRYPTO_FILE = 'crypto.json';
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64');

export async function readCryptoMeta(worldDir: string): Promise<CryptoMeta | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(worldDir, CRYPTO_FILE), 'utf8')) as CryptoMeta;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export const writeCryptoMeta = (worldDir: string, m: CryptoMeta) => atomicWrite(path.join(worldDir, CRYPTO_FILE), stableStringify(m));

function scrypt(pass: string, kdf: CryptoMeta['kdf']): Promise<Buffer> {
  return new Promise((res, rej) =>
    crypto.scrypt(pass.normalize('NFKC'), unb64(kdf.salt), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r }, (e, k) => (e ? rej(e) : res(k))),
  );
}

export const newKdf = (N = 32768): CryptoMeta['kdf'] => ({ name: 'scrypt', salt: b64(crypto.randomBytes(16)), N, r: 8, p: 1 });

/** Wrap a random data key with a passphrase-derived key (so changing the passphrase never rewrites world files). */
export async function wrapKey(dataKey: Buffer, pass: string, kdf: CryptoMeta['kdf']): Promise<CryptoMeta['wrapped']> {
  const kek = await scrypt(pass, kdf);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([c.update(dataKey), c.final()]);
  return { iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
}
/** Returns the data key, or null when the passphrase is wrong. */
export async function unwrapKey(meta: CryptoMeta, pass: string): Promise<Buffer | null> {
  const kek = await scrypt(pass, meta.kdf);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', kek, unb64(meta.wrapped.iv));
    d.setAuthTag(unb64(meta.wrapped.tag));
    return Buffer.concat([d.update(unb64(meta.wrapped.ct)), d.final()]);
  } catch {
    return null;
  }
}
export const codecFor = (key: Buffer): Codec => createAesCodec(key);

/** Passphrase-encrypted envelope for portable files (share bundles). */
export async function sealWithPassphrase(plain: Uint8Array, pass: string): Promise<string> {
  const kdf = newKdf(16384);
  const kek = await scrypt(pass, kdf);
  const codec = createAesCodec(kek);
  return JSON.stringify({ format: 'worldloom-sealed', version: 1, kdf, data: b64(codec.encode(plain)) });
}
export async function openSealed(envelope: unknown, pass: string): Promise<Buffer> {
  const e = envelope as { format?: string; kdf?: CryptoMeta['kdf']; data?: string };
  if (e?.format !== 'worldloom-sealed' || !e.kdf || !e.data) throw new Error('not a sealed Worldloom file');
  const codec = createAesCodec(await scrypt(pass, e.kdf));
  try {
    return Buffer.from(codec.decode(unb64(e.data)));
  } catch {
    throw new Error('wrong passphrase or the file was modified');
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(f);
    else if (e.isFile()) yield f;
  }
}
const SKIP = /(^|[\\/])(\.lock|crypto\.json)$|\.tmp$|\.corrupt-\d+$/;

/**
 * Convert every file under a world folder in place (atomic per file, idempotent, safe to re-run after a crash).
 * to=codec encrypts; to=null decrypts (using `from`). Page files are renamed to `<id>.md` when encrypting
 * (so file names do not reveal titles) and back to `<slug>.md` when decrypting.
 */
export async function convertTree(dir: string, to: Codec | null, from: Codec | null): Promise<{ files: number }> {
  let n = 0;
  const inPages = path.join(dir, 'pages') + path.sep;
  for await (const file of walk(dir)) {
    if (SKIP.test(file)) continue;
    const raw = await fs.readFile(file);
    const enc = isEncrypted(raw);
    if (to ? enc : !enc) {
      // already in target form; pages may still need renaming below
      if (!(file.startsWith(inPages) && file.endsWith('.md'))) continue;
    }
    const plain = enc ? Buffer.from((from ?? to!).decode(raw)) : raw;
    let target = file;
    if (file.startsWith(inPages) && file.endsWith('.md')) {
      const p = parsePageFile(plain.toString('utf8'));
      target = path.join(path.dirname(file), `${to ? p.id : p.slug}.md`);
    }
    if (to && enc && target === file) continue; // already encrypted and correctly named
    const out = to ? (enc ? raw : to.encode(plain)) : plain;
    await atomicWrite(target, out);
    if (target !== file) await fs.rm(file, { force: true });
    n++;
  }
  return { files: n };
}
