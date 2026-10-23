# Architecture

Tokenapp is one local Node.js 24+ process with a static HTML/CSS/JavaScript frontend.
It uses built-in HTTP, SQLite, fetch and compression; it has no npm runtime dependencies.

## Data flow

1. Read-only mounts expose Codex sessions/archived_sessions/title index and Claude projects.
2. lib/importer.mjs scans each concrete provider sequentially on one SQLite connection.
   Plain logs resume from offsets; changed compressed logs stream through Zstandard.
3. lib/store.mjs normalizes and deduplicates numeric usage and stores session metadata.
   Transcript/reasoning bodies are discarded. Imported events survive source deletion.
4. lib/report.mjs selects supported provider scopes, filters events and folds them into
   totals, periods, sessions and provider/model buckets. Each event uses its own provider's
   pricing catalog. The All view changes queries and aggregation, not persistence.
5. public/app.js renders the report, chart, filters and details. Foreground requests use an
   accessible loading dialog; automatic refreshes remain in the background.
6. lib/backups.mjs saves standalone snapshots, checks integrity and atomically publishes them.

## Boundaries

- lib/providers.mjs owns provider-view validation and combined import status.
- lib/usage.mjs owns numeric fields, timezone/date helpers and CSV cell safety.
- lib/pricing.mjs fetches fixed official sources and retains local custom overrides.
- server.mjs coordinates API validation, source scans and price writes. Price writes wait
  for importer transactions to finish. Partial dual-provider fetch failures preserve saved data.
- SQLite owns durable usage, source progress, catalogs and overrides; no external database.
- The browser owns filter/sort preferences. Imported history does not depend on browser storage.

## Operational model

Docker publishes only 127.0.0.1:8787, mounts source logs read only, runs with reduced
privileges and stores state in a persistent data bind mount. Direct Node execution is also
supported. Daily/manual snapshots share the same disk unless the owner copies them elsewhere.

Accounting correctness is covered by synthetic tests, sum invariants, timezone/retention
checks and live aggregate comparisons. Browser checks cover visible attribution, filters,
loading and failure recovery. These checks do not promise compatibility with future log or
pricing-page formats; import and pricing errors must remain visible.

## Development tooling

Spec-Kit 1.1.1 is initialized with Codex skills in .agents/skills/, PowerShell helpers and
templates in .specify/, and a project constitution. These are development artifacts and are
excluded from the Docker build context. The CLI is already installed on the local machine;
the application does not require it at runtime. The generated Spec-Kit material retains its
upstream license at [.specify/LICENSE](../.specify/LICENSE).
