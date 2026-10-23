# Reporting contracts

## Provider selection

GET /api/report, /api/meta, /api/status, /api/pricing and /api/export accept provider=codex,
provider=claude or provider=all. Omission remains codex. Invalid values return 400.
Existing date, timezone, group, model, project, search, archive and session parameters retain
meaning. In All, a raw model name intentionally matches that name in either concrete provider.

## Combined report

GET /api/report?provider=all returns the existing totals/periods/sessions/models/details
structure. Every session/model/detail includes its concrete provider. Models are grouped
by provider and model. Tokens/calls/sessions and custom/unpriced-call counts equal the sum
of identical concrete-provider queries. Costs use each row's provider catalog.

pricing.sources contains one entry per selected provider: provider, source, fetched_at and
available. All has no single source or fetched_at. Existing single-provider pricing source
and timestamp fields remain compatible. No catalogs at all may still yield pricing=null.

## Metadata and status

Metadata unions the supported providers' range, unique raw model names and project paths.
Aggregate status retains providers[], sums file counters, prefixes errors with provider,
and supplies a revision including both snapshots. UI uses Updating sources while a full
scan runs; summed processed counters are not presented as a full-scan progress fraction.

## Pricing actions

POST /api/pricing/refresh?provider=all attempts both independent refreshes. Return providers[]
with provider, ok, fetched_at/error. HTTP 200 means at least one succeeded; partial=true
indicates partial success. If both fail, return 502 with an error and both results. Preserve
all saved rates and manual overrides. Individual-provider refresh responses stay compatible.

GET /api/pricing?provider=all returns concrete provider catalogs under providers; it does not
invent an all catalog. POST /api/pricing/custom?provider=all returns 400. Custom UI edits from
All use the selected model row's concrete provider and retain existing validation/Origin checks.

## CSV

Session rows contain concrete provider and its pricing_fetched_at. Period rows contain the
selected scope, including all; no fabricated single combined timestamp. Both include
pricing_fetched_at_by_provider as a JSON object. Existing numeric columns and formula escaping
remain compatible; wholly unpriced cost cells remain blank.

## UI

The top selector adds All while preserving the existing default and saved selections. All
shows combined chart/totals; model, pricing and session rows identify their provider. Custom
rate dialogs target their row provider. Both official source links and timestamps remain
visible. Reasoning copy explicitly states the missing separate Claude counter. Existing
loading overlays wrap user requests and clear on failure; background polling stays quiet.
