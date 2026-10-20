# Data format (M1–M2)

Data dir: `WORLDLOOM_DATA_DIR`, else `%APPDATA%\Worldloom` / `~/Library/Application Support/Worldloom` / `$XDG_CONFIG_HOME|~/.config/Worldloom`.

```
worlds/<slug>/world.json            continuities, sources, arcs, tier systems, progress
worlds/<slug>/schema/entity-types.json
worlds/<slug>/pages/<type>/<slug>.md
worlds/<slug>/relations.json
worlds/<slug>/assets/<hash>.<ext>
worlds/<slug>/history/<page-id>/<ts>.json    revisions (+ _tx/ undo journals)
backups/                            rolling zips (keep 20) + per-file .bak snapshots
```

A page is YAML frontmatter + Markdown. Keys: `id type title slug aliases redirectsTo status tags categories appliesTo reveal dmOnly fields createdAt updatedAt`.
Hand edits reload live; an invalid edit is reported (file + line) and never replaces the in-memory page. Keep `id` unchanged.

Field values may be wrapped: `{ value, reveal, byContinuity: { <continuityId>: value } }`.

Syntax: `[[Page]]`, `[[Page|label]]`, `[[Page#Section]]`, `[[type:Character/Name]]`, `{{infobox}}`, `{{toc}}`, `{{embed: Page#Section}}`,
`{{src: WN ch 12}}`, `{{claim: confirmed|inferred|theory|retconned}}…{{/claim}}`, `:::continuity{ids="a,b"}`, `:::spoiler{src="wn" at=120}` (or `arc="id"`), `:::diff`.

## Type packs & starter worlds

A type pack is JSON: `{ kind: "worldloom-type-pack", name, description, types: [EntityType] }`; import modes: add new only, overwrite same slug, replace all (blocked if pages still use a removed type).
Built-in packs live in `packages/server/src/packs.ts` and are exported to `starter-worlds/type-packs/`.
Starter worlds (100% original content) are authored in `starter-worlds/src/*.ts` and generated into world folders with `npx tsx starter-worlds/src/build.ts`; a test fails if the committed files drift from the definitions.
`:::dm` blocks and `dmOnly: true` pages are hidden in player view (`player=1`).
