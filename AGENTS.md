# Tokenapp development

This is a local Node.js 24+ dashboard for Codex and Claude Code usage. Start with
[README.md](README.md), [the product baseline](docs/product-baseline.md) and
[the architecture](docs/architecture.md).

Use the project-local Spec-Kit skills in .agents/skills/ and the constitution in
.specify/memory/constitution.md for behavioural changes. The active feature is recorded
in .specify/feature.json. Define acceptance criteria and failing accounting/contract tests
before implementing reporting changes, and keep the corresponding spec, plan, tasks and
validation evidence together under specs/.

## Implementation boundaries

- Raw usage events remain attributable to concrete codex or claude providers. all is a
  reporting scope, never a persisted provider or a custom-price namespace.
- Deduplication, legacy counter corrections and permanent history are established behaviour.
  Do not reimport or migrate data for presentation-only changes.
- Preserve Unpriced, explicit zero rates, custom-rate ownership and provider price provenance.
- Keep user flows plain and local. Reuse the existing chart, filters and loading overlay.
- Do not add runtime packages without a concrete requirement and documented reason.

## Verification and delivery

Run npm test for offline synthetic fixtures. Use node test/live-check.mjs against the
running service, and verify changed flows in a browser. GitHub Actions runs Windows/Linux.
specify integration status --json must report healthy project setup. Use PowerShell scripts
under .specify/scripts/powershell/ for template resolution and prerequisite checks.

Existing user authorization to implement/deploy/publish remains valid; do not create a new
approval gate at each Spec-Kit stage. Report source changes, runtime checks and publication
accurately and separately. Keep failed or incomplete tasks visible in the validation record.

## Private data

Never commit source logs, usage databases, backups, credentials, personal configuration or
real usage samples. Keep data/, .env and private assistant state ignored. Track the generated
project skills, templates and specs only. Review git ls-files before pushing and preserve
the read-only source mounts, loopback binding and protected mutation endpoints.
