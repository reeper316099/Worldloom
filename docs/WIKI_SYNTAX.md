# Wiki syntax

Markdown (GFM) plus:

| Syntax | Meaning |
| --- | --- |
| `[[Page]]` `[[Page|label]]` `[[Page#Section]]` `[[type:Character/Name]]` | Links; titles and aliases resolve, redirects are followed, missing pages render as red links (click to create from the type's template). `#Section` anchors are heading slugs (`h-section-name`). |
| `{{infobox}}` | Marks where an infobox would sit; the app shows the infobox in a sticky card (exports inline it). |
| `{{toc}}` | Table of contents from headings. |
| `{{embed: Page#Section}}` | Transclude a page or a section (depth-limited, spoiler-filtered). |
| `{{src: Web Novel ch 120}}` | Citation chip; resolves to a configured source when the text starts with its name. |
| `{{claim: confirmed\|inferred\|theory\|retconned}}…{{/claim}}` | Claim marker with badge; listed in the page's Claims panel and the health report when unsourced/theory. |
| `:::continuity{ids="wn,ln"}` … `:::` | Content shown only for those continuities. |
| `::::diff` with nested `:::continuity` blocks | Side-by-side differences. **Outer fences need more colons than inner ones.** |
| `:::spoiler{src="wn" at=120}` / `:::spoiler{arc="a3"}` | Spoiler gate; withheld content is removed from the output, not hidden by CSS. |
| `:::dm` | DM-only block (hidden in player view). |
| `:::callout{type="note"}` | Callout box. |

Raw HTML is dropped, URLs are protocol-filtered, and output goes through a sanitizer; XSS payloads render inert (tested). Code spans/blocks are never parsed for wiki syntax, so documentation can show examples.
Unknown `:name` text (e.g. "10:30") is preserved literally.
