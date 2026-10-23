# Research decisions

## Provider scope

Decision: all resolves to the supported concrete providers codex and claude. Preserve the
existing codex default. Reuse the scope in reports, metadata, status and coverage queries.
Rationale: Removing all provider restrictions could accidentally include unsupported source values.
Alternative: A synthetic third provider was rejected because it would blur storage and pricing identity.

## Accounting and identity

Decision: Select the session's provider with every event, use its own catalog, and key model
buckets by provider plus raw model name. Keep session IDs as already stored. No schema change.
Rationale: Identical model labels can have different prices or overrides on different providers.
Alternative: Adding two already-aggregated reports loses useful detail and complicates pagination/filtering.

## Filters and exports

Decision: Model filters retain existing raw string values; in All, identical names match both
providers. Model rows remain separate. Session exports contain their actual provider and its
fetch timestamp; aggregate period exports say all and include a provider/timestamp map.
Rationale: Preserve existing client/filter compatibility without adding a new selection language.

## Pricing refresh and missing information

Decision: Refresh both price sources independently and return per-provider success/error
results. Preserve saved prices and overrides on failure. Keep Unpriced and optional manual rates.
Rationale: One failed source must not discard the other successful update. No inferred prices.

## Status and reasoning

Decision: Aggregate counts and provider-labelled errors, retain both status snapshots, and
show Updating sources rather than a misleading summed progress fraction. Use the oldest
completed scan timestamp only when both have one. The polling signature includes both states.
In All, explain that the separate reasoning counter covers Codex; Claude thinking remains in output.
Rationale: Importers scan sequentially, and their processed counters can belong to different scans.

## Development setup

Decision: Activate the installed Spec-Kit 1.1.1 CLI's bundled Codex skills and PowerShell
scripts in this repository. Document the existing app baseline, then apply the new workflow
to the combined feature. Keep tooling out of the runtime image and private data out of Git.
Rationale: Adding a toolkit alone does not establish accounting correctness; acceptance evidence does.

Evidence: Existing lib/report.mjs, lib/pricing.mjs, server.mjs, public/app.js and regression
tests were inspected. A Spec-Kit-directed read-only research agent independently identified
provider catalog, model-key, CSV, custom-rate and sequential-status hazards. The installed
CLI reports a healthy integration with zero missing/modified managed files.
