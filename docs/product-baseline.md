# Product baseline

Recorded on 2026-10-23 before adding the combined provider view. These are existing
capabilities, not features newly implemented by adopting Spec-Kit.

| Capability | Existing implementation | Verification |
| --- | --- | --- |
| Local read-only Codex and Claude Code imports | lib/importer.mjs, lib/store.mjs, compose.yaml | accounting, importer, compressed and Claude tests |
| Response deduplication, legacy counters and provider-specific cache normalization | lib/store.mjs, lib/usage.mjs | accounting.test.mjs, claude-pricing.test.mjs |
| Persistent SQLite history and standalone checked backups | lib/store.mjs, lib/backups.mjs | durability.test.mjs |
| Per-provider session/day/week/date-range reports and timezone boundaries | lib/report.mjs | accounting.test.mjs and live-check.mjs |
| Model/project/search/archive filters, sortable tables, chart and session detail | public/app.js | existing live checks and browser validation |
| Official model prices, optional local custom rates and Unpriced coverage | lib/pricing.mjs | claude-pricing.test.mjs |
| Loading overlays that release after request failure | public/app.js, public/index.html | browser validation recorded before this feature |
| Local-only service, protected mutations, private-data Git exclusions | server.mjs, compose.yaml, .gitignore | live-check.mjs and tracked-path review |

The pre-feature regression suite contains 31 passing tests on Windows and Linux CI.
It is regression evidence, not proof that every possible workload or source format is covered.
The current feature extends this baseline; its requirements and evidence are in
[specs/001-combined-provider-view](../specs/001-combined-provider-view/spec.md).

## Data and operational boundaries

The application stores numeric usage and session metadata locally. Source message bodies
are read only as necessary to extract usage and are discarded. The database, source logs,
backups, credentials and real usage samples are excluded from the repository. Prices are
current standard USD estimates with documented limitations. Missing prices remain Unpriced.

Container rebuilds retain the data bind mount. Existing backups are not automatically
removed. Source logs deleted before the first import cannot be reconstructed by this tool.
