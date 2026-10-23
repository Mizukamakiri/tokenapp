# Validation: Combined Provider View

**Date**: 2026-10-23

**Application version**: 1.2.0
**Status**: Complete - local deployment, private source publication and GitHub checks verified.

## Executed checks

- Windows: `npm test` passed all 37 tests, including six new combined-view tests.
- Linux: all 37 tests passed using the rebuilt application image, a read-only container,
  a temporary `/tmp`, and the synthetic test directory mounted read only.
- Live service: `node test/live-check.mjs` passed for ChatGPT, Claude and All. The checks
  compared completed UTC days so active conversations could not change between requests.
  Combined integer totals matched exactly, costs matched within USD 0.000001, and daily
  period sums, weekly grouping, provider attribution and exports passed.
- Live pricing: one real refresh from All successfully updated both official catalogs.
- Browser: All rendered combined metrics and chart data; filtering by a Claude model
  showed Claude rows; opening a session retained provider identity. Reloading preserved
  All. Weekly grouping and the Input sort header worked in All.
- Browser failure cases: intercepted pricing responses simulated partial success and total
  HTTP failure. Each displayed the expected warning/error and cleared the loading overlay.
  A rate dialog opened from All identified ChatGPT and targeted `provider=codex` on save.
  The custom save was intercepted: no synthetic rate was written to the actual database.
  All interception routes were removed afterwards and the normal view was restored.
- Spec-Kit 1.1.1: `specify integration status --json` reported `ok`, zero missing or
  modified managed files, and zero invalid manifest paths. The PowerShell prerequisite
  check with `-RequireTasks -IncludeTasks` found the design, contracts and tasks.
- Git whitespace and staged-path checks passed. No source logs, usage databases, backups,
  private assistant state, personal paths or credentials were found in tracked content.
  Ignore checks confirmed the local database, backups, credentials and active-feature
  pointer remain excluded; no personal usage totals or source samples are included here.

## Requirement evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Browser selector offers All, ChatGPT and Claude; provider scope tests reject unsupported values. | Pass |
| FR-002 | Synthetic exact-sum test and live cross-provider comparisons, including daily periods and weekly reports. | Pass |
| FR-003 | Same-named synthetic models retain different provider prices; missing catalog and explicit-zero/custom-rate cases pass. Live costs sum within tolerance. | Pass |
| FR-004 | Metadata/date/model/project/detail/CSV tests; live grouping and export checks; browser model filter, chart, weekly grouping and sort. | Pass |
| FR-005 | Synthetic model/session/detail and CSV provider assertions; live attribution checks; browser provider labels. | Pass |
| FR-006 | Real dual refresh succeeded. Synthetic partial/total fetch failures preserve saved rates and overrides; browser partial and total failures report correctly. | Pass |
| FR-007 | Synthetic provider-specific custom rates and rejected All mutation; live aggregate-mutation guard; mocked browser save targets the row provider. | Pass |
| FR-008 | Browser reload retains All; successful, partial-failure and total-failure requests clear loading feedback. | Pass |
| FR-009 | Aggregate status tests cover incomplete initial scans, provider errors, timestamps and revision changes; empty-provider reports retain available usage. | Pass |
| FR-010 | Synthetic before/after event comparison; unchanged store/importer/backup implementation; existing retention, deduplication and backup tests pass. Read-only source mounts, loopback binding and tracked-content exclusions verified. | Pass |
| FR-011 | Healthy project-local Codex integration; constitution, baseline, architecture, specification, design, completed tasks and this requirement record are published. | Pass |

These checks satisfy SC-001 through SC-005. GitHub checks passed separately as recorded
below; their result is not inferred from local test success.

## Failures found and corrected

The first targeted run produced five expected failures before All support and coordinated
price refresh existed; the status check initially failed because its new module was absent.
A CSV assertion was corrected to account for quoted cells. After implementation the full
suite passed. A restricted Windows run encountered a sandbox file-rename error; the ordinary
Windows suite passed when executed with the required filesystem access.

Browser testing found a background poll could supersede a foreground filter request and
let its loading overlay close before the selected report rendered. Polling now checks for
foreground loading before metadata refresh and again before starting a quiet report.
The filter, detail and persisted-selection checks passed after that correction.

## Constitution and release review

The post-implementation constitution check passes: All is a report scope over exactly two
concrete providers, prices remain provider-owned, missing measurements remain labelled,
and no persistence migration or runtime dependency was added. Spec-Kit development files
are excluded from the runtime image. The existing capabilities are documented as a baseline,
with new feature evidence kept in this directory.

The local Docker service has been rebuilt and the changed flows verified against it.
Docker reports the service healthy at `127.0.0.1:8787`; all source mounts are read only,
with only the durable data directory writable. Hashes of all changed runtime files match
the deployed image.

Source revision `65837cb52dad5d11259d204265b28b702eb34223` was published to the existing
private repository. [GitHub Actions run 39916366145](https://github.com/Mizukamakiri/tokenapp/actions/runs/39916366145)
completed successfully on Windows and Ubuntu. Both jobs ran the complete 37-test suite.
The final follow-up commit only closes this documentation and task record; runtime source
is unchanged, so it does not require a repeat test run.
