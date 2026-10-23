# Tokenapp

A local dashboard for Codex and Claude Code token usage, with per-model cost estimates. Choose **ChatGPT** or **Claude** at the top to switch sources. The ChatGPT view reads local Codex sessions; ordinary ChatGPT and Claude web chats are not imported.

## Features

- Per-session, daily, weekly and inclusive custom date ranges, with timezone-aware boundaries.
- Sortable tables, model/project/search filters, session detail and CSV exports.
- Input, cached input, cache writes, output and available reasoning counts.
- A **Fetch pricing** button for the selected provider, plus current USD estimates by session, day, week and model. Expand **Model pricing** to inspect rates and the fetch date.
- Permanent SQLite history, incremental imports and daily integrity-checked backups.
- No API keys, npm dependencies, transcript database or external frontend resources.

## Docker Desktop

Copy .env.example to .env and set CODEX_DATA_HOME and CLAUDE_DATA_HOME to the source folders on your machine. Use forward slashes in Windows paths. On Linux/macOS, use absolute paths to your home folders instead. Set APP_TIMEZONE if needed.

Run from the application folder:

    docker compose up -d --build

Open http://localhost:8787. On Windows, start.ps1 creates a local .env using your user profile if one does not exist. Stop with stop.ps1 or docker compose stop. The service restarts with Docker Desktop.

The source mounts must exist: Codex sessions/, archived_sessions/, session_index.jsonl, and Claude projects/. Missing mounts produce a Docker error rather than creating directories in your source folders. Both sources are required by this Compose configuration; to use only one provider, run directly with Node instead.

Only localhost can reach the published port. The container mounts source directories read only and does not mount credentials. Its data/ folder persists across container rebuilds.

## Node.js 24+

    npm start

Defaults: local user .codex and .claude folders, localhost port 8787, Europe/Helsinki timezone, a 15-second import interval, and data/usage.sqlite. Optional environment variables: CODEX_HOME, CLAUDE_HOME, DB_PATH, BACKUP_DIR, PORT, HOST, APP_TIMEZONE, SCAN_INTERVAL_MS. A missing provider is shown in import health; the other provider can still be used. The direct Node process uses environment variables, not the Docker .env file.

## Token accounting

Codex plain .jsonl and Zstandard .jsonl.zst files are imported from sessions and archived_sessions. Per-call token_usage_record entries are deduplicated globally by response ID and take precedence over mirrored token_count notifications within their turn. Legacy logs use differences between cumulative counters. Counter resets and repeated snapshots are handled; an initial partial snapshot contributes only its known latest call. Missing earlier usage is not assigned an invented date.

Claude Code .jsonl and .jsonl.zst files are imported recursively from projects, including subagents. Repeated streaming/content-block records are deduplicated by message ID, retaining the highest counters for that response. Subagent usage belongs to its parent session when the source records supply that session ID. Synthetic/API-error messages are excluded. Claude input counts are normalized as uncached input plus cache reads plus cache writes. Cache writes retain the one-hour breakdown when available. Claude logs do not supply a separate thinking-token count, so the UI says it is unavailable rather than presenting zero as a measurement.

For both providers, cached input and cache writes are subsets of input; reasoning is a subset of output. Total is input plus output. Only session metadata and numeric usage are saved, never message or reasoning bodies. Source cleanup, compression, truncation or removal does not delete imported usage. Source availability is tracked separately. Logs already deleted before the first import cannot be recovered by this app.

Day and Monday-based week boundaries use the selected timezone, including daylight saving. Filters apply to individual call timestamps, so sessions spanning midnight are split correctly. Missing usage remains unknown. Imports tolerate incomplete trailing lines, report malformed/oversized lines, resume plain logs from saved offsets and replay changed compressed archives.

## Pricing

Fetch pricing reads the official providers' Markdown tables over HTTPS:

- https://developers.openai.com/api/docs/pricing
- https://platform.claude.com/docs/en/about-claude/pricing

No usage data is sent: only a request for the public pricing page. Fetches have a timeout, a size limit and a fixed destination. A failed fetch or unrecognized table preserves saved rates. Prices are stored locally and included in database backups.

Costs apply the latest fetched **standard API list prices** to all selected usage, including historical usage. They are estimates of token value, not subscription charges, historical invoices or allowance percentages. Tools, taxes, special deals, speed tiers, regional processing premiums and other charges are excluded. Unknown models/rates show as unpriced, never a fabricated zero; partial totals display their unpriced-call count. Dated model IDs match their base model rates.

Per-call estimates use the published long-context tier when available (OpenAI over 272K input tokens; Claude Haiku 5.5 over 100K). Legacy aggregate deltas use short-context rates because individual request lengths are unknown. Claude cache writes use separate five-minute/one-hour prices when logged. An unknown write duration uses the shorter-duration price. Changing prices recalculates estimates without changing saved token counts.

## Saved data and backups

Saved history lives in data/usage.sqlite with live SQLite journal files alongside it. Keep the entire data folder when moving the app. Once per configured calendar day after a scan, an integrity-checked standalone SQLite snapshot is saved in data/backups. **Backup now** saves an additional snapshot. Existing backups are never automatically removed. Completed snapshots are checked and atomically renamed into place; failures appear in import health.

Backups contain session metadata and numeric usage, not chat/reasoning bodies. For disk-failure protection, copy the backup folder to another drive or a backup destination you choose.

Restore: stop the app; move the current database and its matching -wal/-shm files into a recovery folder; copy a completed snapshot to data/usage.sqlite; restart and verify totals before removing the recovery folder.

## Repository privacy

The repository contains application code, synthetic tests, documentation, and example configuration. data/, backups/, logs/, .env files, raw .jsonl/.jsonl.zst logs and SQLite databases are ignored. .env.example is safe to commit. Docker builds also exclude private data. Do not force-add ignored files. No real usage samples or personal source paths are needed in the repository.

## Validation and HTTP endpoints

    npm test

Offline tests cover both import formats, streaming deduplication, subagents, counters, compression, retention, backups, dates/DST, filters, CSV output, official-table parsing, cache costs, context tiers, missing prices and failed fetch recovery. GitHub Actions runs the suite on Windows and Linux with Node 24.

Optional live checks against a running app:

    node test/live-check.mjs

GET: /api/health, /api/status, /api/meta, /api/report, /api/export, /api/pricing. POST: /api/refresh, /api/backup, /api/pricing/refresh. Use provider=codex or provider=claude (default codex). Mutation endpoints require application/json and reject foreign Origin headers. No chat-body endpoint exists.
