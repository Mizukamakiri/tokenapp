# Validation guide

Run from the tokenapp repository with Node.js 24+; Docker Desktop is needed for deployment.
Real logs, usage databases, local configuration and backups must remain untracked.

1. Run specify integration status --json. Expect status ok and zero missing managed files.
2. Run npm test. Expect existing and combined-provider tests to pass without real logs.
3. Run docker compose up -d --build with the local .env already configured.
4. Run node test/live-check.mjs. Expect concrete and combined aggregate/export checks to pass.
   A historical cutoff avoids changes from an actively importing current-day conversation.
5. Open http://localhost:8787, select All and All time, then compare counts and costs against
   each individual provider. Repeat daily/weekly, a date range, a model and a project filter.
6. Inspect one session from each provider and both pricing sources. Verify custom-rate edit
   requests identify the row provider; cancel or mock the edit rather than entering test prices
   into personal data. Unpriced rows must remain Unpriced until a user enters a rate.
7. Reload with All selected and verify selection persistence. Simulate a failed price source
   and verify saved rates remain visible, partial success is reported and loading clears.
8. Review Git's tracked paths before publishing. Run the documented CI on Windows/Linux and
   record acceptance evidence in validation.md. Do not claim checks pass before running them.

Contracts: [reporting.md](contracts/reporting.md). Accounting/data identity: [data-model.md](data-model.md).
