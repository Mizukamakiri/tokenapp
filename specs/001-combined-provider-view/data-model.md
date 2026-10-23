# Data model

## Persisted entities

The existing sessions, events, files, pricing and price_overrides tables are unchanged.
Concrete provider values remain codex and claude; all is never written to these tables.
Sources, event IDs, normalized token fields and custom-rate ownership remain unchanged.

## Provider view

Allowed values: codex, claude, all. Default: codex. all expands to exactly codex and claude.
Invalid views are rejected. Custom-rate mutations require a concrete provider.

## Report row identity

- Session: existing global session ID plus explicit provider in responses.
- Model bucket: pair of concrete provider and raw model name.
- Detail: existing event timestamp/model plus concrete provider.
- Period: day or Monday-based week within the selected timezone, across selected providers.

Counts remain non-negative integers. Total tokens equal input plus output. Existing
cached/write and reasoning subset rules are unchanged. Estimated USD costs remain numeric
sums of priced calls; missing calls increment unpriced_calls; explicit zero rates stay priced.

## Pricing provenance

A selected provider has its own catalog, fetched_at (nullable), official source, published
rates and local overrides. A combined report exposes sources for both providers. It has no
single combined source or fetched timestamp. Same-named models cannot share overrides.

## Aggregate import status

Keep each provider snapshot. initialized requires both providers to finish an initial scan;
running covers the whole coordinated scan; counts are sums. lastScan is the oldest completed
provider timestamp, or null if any provider has no completed scan. Errors identify the provider.
A revision combines both snapshots so either provider can trigger a background report update.
