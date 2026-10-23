# Tokenapp Constitution

## Core Principles

### I. Reproducible accounting

Recorded token counts MUST remain attributable to a provider, session and usage event.
Duplicate source records MUST be counted once. Cached input and cache writes MUST remain
subsets of input; reasoning MUST remain a subset of output. Combined views MUST equal the
sum of the same independently filtered provider views. Unknown measurements MUST remain
unknown rather than being presented as measured zero.

### II. Local ownership and durable history

Imports MUST read source logs without modifying them. Imported usage MUST survive source
cleanup and container rebuilds. Backups MUST be standalone, integrity checked and published
atomically. Transcript and reasoning bodies MUST NOT be persisted by the application.
Logs, usage databases, backups, credentials and personal configuration MUST stay out of Git.

### III. Requirements with executable evidence

Changes to accounting or reporting contracts MUST start with written acceptance criteria
and tests that fail for the missing behaviour. Plans and tasks MUST identify the relevant
requirements, source files and validation. Existing tests MUST pass before release. Runtime
verification and source publication MUST be reported separately. Documentation of an
existing capability MUST be labelled as a baseline rather than new implementation.

### IV. Honest cost estimates

Each usage event MUST use its own provider's model rate. Published and user-entered prices
MUST remain distinguishable. Missing prices MUST display Unpriced with optional manual
entry. Missing rates MUST NOT be invented, including for internal model labels. Fetch
failures MUST preserve saved rates and manual overrides. Estimates MUST state their USD
API-rate basis and MUST NOT be represented as subscription invoices or allowance usage.

### V. Small, usable and inspectable implementation

The existing dependency-light architecture MUST be preferred unless a requirement justifies
additional complexity. User-triggered waits MUST show accessible loading feedback and
release it after success or failure. Automatic updates MUST NOT repeatedly block the UI.
Filters, sorting, charts, details and exports MUST describe the same selected data.

## Security and operational constraints

- The published service MUST bind to loopback by default; source mounts MUST be read only.
- Network pricing requests MUST use fixed official destinations and MUST NOT send usage data.
- Mutation endpoints MUST reject foreign origins and validate bounded request bodies.
- CSV exports MUST escape spreadsheet formulas and preserve provider attribution.
- Repository tests and documentation MUST use synthetic examples, never personal usage samples.
- Spec-Kit skills, templates and specifications belong in the repository; private runtime
  state and assistant credentials do not. Development tooling MUST NOT become an app runtime dependency.

## Development workflow and release gates

For each behavioural change, maintain a feature specification, design, tasks and validation
record under specs/. Check the constitution during planning and after implementation.
Run targeted failure tests first, implement, then run the applicable regression suite and
live checks. Review tracked paths before pushing. Preserve existing data, verify backups
when persistence changes, and deploy only the verified source revision. Work already
authorized by the user does not require another confirmation at each workflow stage.

## Governance

This constitution governs project-local development subject to the user's instructions.
Amendments MUST describe the reason and affected contracts. Use a major version for removed
or incompatible principles, a minor version for new obligations, and a patch for clarifications.
Record adoption dates and review compliance in each implementation plan. Unfinished work or
failed checks MUST remain visible; installing a toolkit alone is not evidence of correctness.

**Version**: 1.0.0 | **Ratified**: 2026-10-23 | **Last Amended**: 2026-10-23
