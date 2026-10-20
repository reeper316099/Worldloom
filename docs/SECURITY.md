# Security

- **No network.** The only optional exception is the Lorekeeper link (see PRIVACY_AND_SYNC.md): off by default and limited to loopback addresses by the server. The renderer's session cancels every request whose origin is not the local server; permissions are denied; new windows and external navigation are blocked. There is no telemetry, update check or remote font/CDN.
- **Process isolation.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the only bridge is `window.worldloom` (`{baseUrl, token}`) and `window.worldloomDesktop` (choose/reveal data dir, menu events). IPC handlers answer only the app's own window.
- **API.** Binds `127.0.0.1` on an ephemeral port; every `/api` route requires a per-launch random bearer token (constant-time compare; a query token is accepted only for SSE and asset GETs). Zod validates every request; errors use one shape with a request id; logs never contain page content or query strings.
- **UI delivery.** Served same-origin with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'` (no `unsafe-eval`); static file serving is traversal-safe.
- **Content.** Markdown is sanitized (no raw HTML, filtered protocols). Uploaded images are content-addressed, size-limited, type-sniffed by magic bytes; SVGs with scripts, external references, DOCTYPE/entities or `<use>/<image>` are rejected; assets are served with a sandboxing CSP and `nosniff`. Asset names are validated, never joined from user input.
- **Files.** Atomic writes, per-file mutex, quarantine + backup restore for corrupt files, zip backups before launch (>6 h), imports, bulk deletes and world deletion. Backup restore rejects path traversal.
- **Spoilers are a privacy boundary inside the app:** see SPOILERS.md; enforced and tested server-side.

Reporting: open an issue, or contact the maintainers privately for sensitive findings. Not yet audited; unsigned builds (see README).

- **Encryption at rest** (opt-in per world): AES-256-GCM with scrypt-wrapped data keys; see PRIVACY_AND_SYNC.md for scope and limits.
