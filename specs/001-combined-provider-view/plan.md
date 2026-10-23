# Implementation Plan: Combined Provider View

**Branch**: main | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: specs/001-combined-provider-view/spec.md

## Summary

Add all as a report scope over codex and claude. Reuse event normalization and the existing
chart, with one catalog lookup per concrete provider and explicit provider attribution in
mixed rows. No migration, reimport, new runtime dependency or change to recorded usage.
Project-local Spec-Kit provides the development workflow; the existing app is documented
as a verified baseline rather than being rewritten merely to adopt tooling.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js 24+, HTML/CSS, PowerShell development scripts.
**Primary Dependencies**: Built-in HTTP, SQLite, fetch and compression; no npm dependencies.
**Storage**: Existing SQLite sessions/events/files/pricing/price_overrides tables; schema unchanged.
**Testing**: node:test synthetic fixtures, optional live checks and browser validation; Windows/Linux CI.
**Target Platform**: Windows host with Docker Desktop/Linux container, modern browser.
**Project Type**: Local web application.
**Performance Goals**: One event iteration per report; price catalogs loaded once per selected provider;
no extra transcript scans for combined reporting. Measure runtime behaviour during validation.
**Constraints**: Preserve provider defaults, saved filters, raw counts, privacy and existing endpoint shapes.
**Scale/Scope**: Two providers, one user, existing local history. No additional integrations or analytics platform.

## Constitution Check

| Gate | Before design | After design |
| --- | --- | --- |
| Reproducible counts and provider-specific costs | Pass: explicit sum assertions required | Pass: concrete provider selected per event |
| Read-only sources and durable local storage | Pass: no persistence changes | Pass: combined scope never stored as a provider |
| Requirements and executable evidence | Pass: FR-001..011 and test-first tasks | Pass: contracts, tasks and validation guide defined |
| Honest published/custom/unpriced estimates | Pass: existing semantics retained | Pass: missing catalogs cannot use another provider's rates |
| Small, accessible implementation | Pass: current architecture retained | Pass: chart unchanged; existing loading wrapper reused |

## Project Structure

### Documentation (this feature)

- spec.md: user outcomes and acceptance criteria.
- research.md: decisions from source inspection and a focused read-only research review.
- data-model.md: provider scopes and report identity.
- contracts/reporting.md: request/response and partial-refresh behaviour.
- quickstart.md: runnable verification.
- tasks.md: execution sequence and completion state.
- validation.md: requirement-to-evidence record, completed after implementation.

### Source Code (repository root)

- lib/providers.mjs: concrete provider scope and combined import status.
- lib/report.mjs: scoped report queries, model grouping, pricing provenance and CSV.
- lib/pricing.mjs: independent concrete-provider fetches with partial results.
- server.mjs: all-capable read endpoints and aggregate pricing refresh.
- public/index.html and public/app.js: selector, mixed attribution and provider-safe rate edits.
- test/combined.test.mjs and test/live-check.mjs: accounting and HTTP acceptance evidence.
- .specify/ and .agents/skills/: project-local development tooling; excluded from Docker context.

**Structure Decision**: Extend existing boundaries, adding only a small shared provider helper.
No application source moves or new services.

## Complexity Tracking

No constitution violations or additional runtime dependencies. No unresolved design questions.
