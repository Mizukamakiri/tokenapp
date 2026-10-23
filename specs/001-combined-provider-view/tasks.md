# Tasks: Combined Provider View

**Input**: spec.md, plan.md, research.md, data-model.md and contracts/reporting.md in this directory.
**Tests**: Required by FR-002, SC-004 and constitution III; write failure cases before implementation.

## Phase 1: Setup

- [X] T001 Initialize Spec-Kit Codex/PowerShell files in .agents/skills/ and .specify/ (FR-011).
- [X] T002 Adopt accounting, privacy, evidence and pricing principles in .specify/memory/constitution.md (FR-010, FR-011).
- [X] T003 Document existing capabilities and limitations in docs/product-baseline.md (FR-011).

## Phase 2: Foundational

- [X] T004 Write spec.md, plan.md, research.md, data-model.md, contracts/reporting.md and quickstart.md under specs/001-combined-provider-view/ (FR-001..011).
- [X] T005 Write and run failing combined count, metadata, scope and identity tests in test/combined.test.mjs (FR-002, FR-004, FR-005, FR-010).
- [X] T006 Implement lib/providers.mjs: "Allowed values: codex, claude, all. Default: codex. all expands to exactly codex and claude" (FR-001, FR-009).

## Phase 3: User Story 1 - Combined overview

Goal: All combines both sources using existing chart periods. Independent test: counts equal the sum.

- [X] T007 [US1] Update scoped queries, metadata unions and provider coverage in lib/report.mjs (FR-002, FR-004, FR-010).
- [X] T008 [US1] Accept All in server.mjs read endpoints and aggregate both source statuses through lib/providers.mjs (FR-001, FR-009).
- [X] T009 [US1] Add and persist All in public/index.html and public/app.js; reuse chart data and identify incomplete reasoning counters (FR-001, FR-002, FR-008).

## Phase 4: User Story 2 - Combined costs

Goal: Own-provider prices, truthful partial coverage and safe rate edits. Independent test: distinct provider rates sum correctly.

- [X] T010 [US2] Write and run failing mixed-rate, missing-catalog, zero/custom-rate and partial-refresh tests in test/combined.test.mjs (FR-003, FR-006, FR-007).
- [X] T011 [US2] Select the correct per-row catalog and key models by provider plus raw name in lib/report.mjs (FR-003, FR-005).
- [X] T012 [US2] Add independent refresh results in lib/pricing.mjs and provider=all coordination in server.mjs; custom mutations require a concrete provider (FR-006, FR-007).
- [X] T013 [US2] Attribute price sources and model-rate edits to concrete providers in public/app.js and public/index.html (FR-003, FR-006, FR-007).

## Phase 5: User Story 3 - Inspection and export

Goal: Combined filters, details and exports retain attribution. Independent test: filtered results and exported sums match.

- [X] T014 [US3] Add session/detail attribution and concrete-provider CSV timestamps, plus provider timestamp maps, in lib/report.mjs (FR-004, FR-005).
- [X] T015 [US3] Identify providers in session/model/pricing rows and session detail in public/app.js (FR-004, FR-005).
- [X] T016 [US3] Extend test/live-check.mjs for combined aggregates, historical comparisons, exports and invalid aggregate rate mutations (FR-002..009).

## Phase 6: User Story 4 - Engineering workflow

Goal: The installed workflow and source are maintainable. Independent test: setup healthy and requirements traceable.

- [X] T017 [US4] Record architecture and development commands in docs/architecture.md, AGENTS.md and README.md; include .specify/LICENSE (FR-011).
- [X] T018 [US4] Keep runtime/private assistant state ignored while tracking only project skills and specifications in .gitignore and .dockerignore (FR-010, FR-011).

## Phase 7: Polish and release

- [X] T019 Run npm test, the live guide and browser checks; record results per requirement in specs/001-combined-provider-view/validation.md (FR-001..011).
- [ ] T020 Review private-data exclusions and Spec-Kit health, deploy the verified revision, publish source and verify Windows/Linux CI; update tasks.md and spec.md (FR-010, FR-011).

## Dependencies and execution order

T001..004 precede behaviour changes. T005 precedes T006..009; T010 precedes T011..013.
T014..016 build on the provider-aware report. T017..018 can be prepared while tests run,
but edits to shared files remain sequential. T019 precedes publication in T020.

## Parallel opportunities

US1: metadata test design and selector design can be reviewed independently after T004.
US2: mocked network-failure cases can be reviewed independently from rate-table UI design.
US3: CSV contract review and browser verification use different artifacts after implementation.
US4: documentation review and setup health checks are independent of chart rendering.
Only the read-only research review was delegated; implementation is sequential in this change.

## Implementation strategy

Verify the sum invariant first, then provider pricing, then inspection/export. Keep all
three views available throughout. No data migration or runtime dependency is introduced.
Document failed checks and fix them before marking tasks complete; do not treat installation
or documentation as evidence that a behavioural test passed.
