# Encryption, Lorekeeper link, and sync (M9)

## Encrypted worlds
- Per world, opt-in (*Import / Export → Encryption*). Every file in the world folder (pages, JSON config, history, boards, assets, undo journals) is encrypted at rest with **AES-256-GCM**, each write with a fresh random IV and an authentication tag, so tampering is detected.
- A random 256-bit **data key** is wrapped by a key derived from your passphrase with **scrypt** (N=32768, r=8, p=1, per-world salt). `crypto.json` holds only the salt, the wrapped key and a label. Changing the passphrase re-wraps the key; no world file is rewritten. **There is no recovery**: forget the passphrase and the data is gone.
- Page files are renamed to `<id>.md`, so file names no longer reveal titles. While locked, the world list shows only the label you chose.
- Unlocking keeps the key in memory only; *Lock now*, quitting, or *Settings → Auto-lock* forget it. Wrong passphrases are throttled.
- Enabling is crash-safe: a marker in `crypto.json` is written first, each file is converted atomically, and unlocking finishes an interrupted migration. Mixed plain/encrypted folders stay readable.
- Enabling deletes older automatic backups by default (they may hold unencrypted copies). Backups made afterwards are ciphertext.
- Not covered: exports (JSON/Markdown/HTML/CSV) are plaintext by design; the in-memory search index; the OS swap/page file; hand-editing files (they are ciphertext).

## Lorekeeper link (opt-in)
Reads your reading/watching progress from the sibling Lorekeeper app's **local** API (`GET /api/v1/entries`, bearer token) and moves your spoiler progress forward.
- Settings → Lorekeeper: enable, address, token. **Off by default.** The server accepts only plain-http loopback addresses (`127.0.0.1`, `localhost`, `::1`), no credentials in the URL, redirects refused, 5 s timeout — so enabling it still means **nothing leaves your computer**. The token is stored in `config/settings.json` and never returned by the API.
- Canon → Sources: link a source to a Lorekeeper entry and choose *where I am* (`current`) or *how far my recap goes* (`consumedUpTo`). Season numbers are ignored (position only).
- Sync button in the progress panel (and once automatically when you open the panel): *only move forward* never lowers progress; *mirror exactly* follows Lorekeeper. A completed entry counts as its total units.
- Lorekeeper's packaged app picks a random port/token per launch, so use its dev server (port 4317, token `dev-token`) or a fixed `PORT`/`LOREKEEPER_TOKEN` until it exposes a stable address.
- AniList lookup is **not** implemented (it would need real network access).

## Sharing and sync (no cloud)
- **Bundles** (`*.worldloom-bundle`): a JSON file of a world (pages, types, relations, timeline, config) — optionally *sealed* with a passphrase (scrypt + AES-GCM). Your reading progress is never included. Bundles **without spoilers** contain only what you can see and can never overwrite existing pages when merged.
- **Merge** is three-way per page using the last shared state: only-one-side-changed wins; edited on both → conflict, resolved by your choice (default: keep the newer, save the other as a draft page tagged `sync-conflict`, so no text is lost). Deletions are never propagated; independently created pages with the same title are added as “Title (from sync)”. Types, relations, timeline events and sources/arcs/continuities are unioned and never overwritten. Every merge takes a backup first and is undoable.
- **Folder sync**: point at a folder shared by Dropbox/iCloud/USB; Worldloom reads/writes one file `<world-id>.worldloom-sync` there (contains spoilers; encrypted worlds require a passphrase so it is sealed). On another machine use *Join synced world…*. If the file changes while you sync, the run aborts so you can retry.
