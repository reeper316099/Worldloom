import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Transparent per-file transform (encryption at rest). Plain files pass through `decode` unchanged. */
export interface Codec {
  encode(plain: Uint8Array): Uint8Array;
  decode(raw: Uint8Array): Uint8Array;
}

const MAGIC = Buffer.from('WLENC1\n');
export const isEncrypted = (raw: Uint8Array) => raw.length > MAGIC.length && Buffer.from(raw.subarray(0, MAGIC.length)).equals(MAGIC);

/** AES-256-GCM, fresh random IV per write. Layout: MAGIC | iv(12) | tag(16) | ciphertext. */
export function createAesCodec(key: Buffer): Codec {
  if (key.length !== 32) throw new Error('key must be 32 bytes');
  return {
    encode(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain), c.final()]);
      return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
    },
    decode(raw) {
      if (!isEncrypted(raw)) return raw; // tolerate plaintext files (mixed state during migration, hand-added files)
      const b = Buffer.from(raw);
      const iv = b.subarray(MAGIC.length, MAGIC.length + 12);
      const tag = b.subarray(MAGIC.length + 12, MAGIC.length + 28);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      try {
        return Buffer.concat([d.update(b.subarray(MAGIC.length + 28)), d.final()]);
      } catch {
        throw new Error('decryption failed (wrong key or the file was modified)');
      }
    },
  };
}

export async function readDecoded(file: string, codec?: Codec): Promise<Buffer> {
  const raw = await fs.readFile(file);
  return codec ? Buffer.from(codec.decode(raw)) : raw;
}
export async function readText(file: string, codec?: Codec): Promise<string> {
  return (await readDecoded(file, codec)).toString('utf8');
}
