# Spoiler system

## Model
- **Progress** (per world): a position per source (chapter/episode/session), an optional "finished arc" checkpoint, `showAll`, and per-item overrides (`revealed`). Unknown progress = hidden.
- **Gates** (`Reveal`): `{sourceId, at}` (inclusive) or `{arcId}`. They can sit on a page, a `:::spoiler{src="wn" at=120}` / `arc="a3"` block, a field value (`{value, reveal}`), an explicit relation, a tier system, or an arc.
- **Visible** iff `showAll`, or the item was individually revealed, or every gate on the item and its ancestors is satisfied. A checkpoint implies floors for each source: the range end for primary-continuity sources and the range start (lowest) for others (`impliedFloor: 'full'` uses range ends everywhere).
- **Author mode** shows everything (badges only); **reader mode** applies progress. **Player view** (`player=1`) additionally hides `dmOnly` pages and `:::dm` blocks. `hideTitles` (setting) masks the titles of gated pages everywhere; otherwise they show greyed.

## Guarantee
Filtering happens in the API (`mode=reader` is the default; `mode=author` must be asked for). Withheld content is *removed*, not hidden with CSS: rendered HTML contains a placeholder only. Search uses a separate reader index built from filtered text (links flattened so hidden titles can't leak through link text); backlinks, hover cards, relations, categories, suggest, compare and arc names are filtered the same way. Author-only routes (`raw`, `history`, `health-report`, `relations/explicit`, `render`) return 403 to readers.

Config endpoints (`/worlds/:w`, `/arcs`) mask arc names/summaries and gated tier systems in reader mode; the UI requests `mode=author` for them only on configuration screens (canon manager, progress panel).

## Leak suite (`packages/server/test/leaks.test.ts`)
Installs both demo worlds at zero progress with `hideTitles` on, walks **every registered GET route** (all pages × ids/slugs, search with probe terms, compare, cards, relations…) in default and player mode, and fails on any gated string or gated title. A route table check fails the build if a GET route is added without being classified `filtered`, `author-only`, `safe` or `skip`. A control test proves the check can fail (with `showAll` every secret renders), and mutating the visibility code makes the suite fail.

Not yet covered because the features don't exist yet: graph, timeline, tier ladders (M7), exports (M8). They must be added to the classification table when built.

## Visual tools (M7)
Graph, trees, timeline, tier ladders, multi-compare and tier-list boards are all filtered server-side and covered by the leak suite. Notable rules: a timeline event is shown only if its own gate, its arc, and *every page it mentions* are visible; relation edges require both endpoint pages and the edge gate; gated tiers disappear from ladders; a reader saving a tier list never drops placements of pages they cannot see (the server merges them back). Maps and cosmology diagrams (stretch goals) are not implemented yet.
