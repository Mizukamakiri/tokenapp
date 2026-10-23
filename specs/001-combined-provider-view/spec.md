# Feature Specification: Combined Provider View

**Feature Branch**: `main`

**Created**: 2026-10-23

**Status**: Complete - deployed, published and validated

**Input**: Add an All option alongside Claude and ChatGPT to see combined tokens and
costs, including the existing chart. Activate project-local Spec-Kit and establish an
engineering baseline for the existing application.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the combined overview (Priority: P1)

The owner selects All and sees the total activity recorded by Claude and ChatGPT in one
overview, without changing the meaning of the individual views.

**Why this priority**: It answers how much was used across both tools without manual addition.

**Independent Test**: Compare All with the sum of the two provider views for the same dates.

**Acceptance Scenarios**:

1. **Given** recorded activity from both providers, **When** All is selected, **Then**
   token, call and session totals equal the sum of the two individual views.
2. **Given** a date range and timezone, **When** daily or weekly grouping is selected,
   **Then** every combined period equals the sum for that period across both providers.
3. **Given** only one provider has recorded activity, **When** All is selected,
   **Then** the available activity remains visible with accurate totals.

### User Story 2 - Understand combined costs (Priority: P1)

The owner sees the value of priced usage across both tools while retaining visibility of
unpriced calls and any optional rates they entered.

**Why this priority**: Combining tokens without correct provider-specific costs is misleading.

**Independent Test**: Use distinct prices for otherwise identically named models from two
providers, and verify each contributes its own cost to the combined result.

**Acceptance Scenarios**:

1. **Given** published or custom rates for both providers, **When** All is selected,
   **Then** combined estimated cost equals the sum of the two separate estimated costs.
2. **Given** an unpriced model, **When** All is selected, **Then** its usage is included,
   its cost remains Unpriced and the displayed partial total states its coverage.
3. **Given** All, **When** Fetch pricing is used, **Then** both providers are refreshed;
   a failure for one provider preserves its saved rates and reports the partial failure.
4. **Given** an unpriced model in All, **When** a custom rate is entered,
   **Then** it applies only to that model's provider and is labelled Custom.

### User Story 3 - Inspect and export combined activity (Priority: P2)

The owner filters, sorts, inspects sessions and exports the same combined data shown in
the overview, with enough attribution to identify which tool produced each record.

**Why this priority**: The overview must remain explainable and useful for further analysis.

**Independent Test**: Select a combined model/project/date range, inspect one session from
each provider and compare the displayed totals with exported totals.

**Acceptance Scenarios**:

1. **Given** All, **When** the owner uses model/project/search/date filters,
   **Then** all visible totals, chart periods and rows use the same selection.
2. **Given** sessions or models from both providers, **When** their rows are displayed,
   **Then** the provider is identifiable even when model names are the same.
3. **Given** a saved All selection, **When** the dashboard is reopened,
   **Then** All remains selected and valid filters are restored.
4. **Given** All, **When** a session is opened or data is exported,
   **Then** provider attribution is retained and no usage is counted twice.

### User Story 4 - Maintain the tool through a documented workflow (Priority: P2)

The maintainer can find the project's requirements, accounting rules, design and runnable
validation steps beside the source, and use the locally installed development workflow.

**Why this priority**: The project needs an inspectable basis for future changes.

**Independent Test**: Verify local workflow readiness and follow the feature's validation guide.

**Acceptance Scenarios**:

1. **Given** the app repository, **When** the local development setup is checked,
   **Then** Spec-Kit recognizes the project and reports no missing managed files.
2. **Given** an existing capability, **When** it is documented,
   **Then** it is identified as a baseline with references to its validation evidence.
3. **Given** the combined-view feature, **When** its requirements are reviewed,
   **Then** each requirement has a corresponding task and validation result.

### Edge Cases

- A provider is missing, empty, still importing or unavailable.
- Only one provider has fetched prices; one pricing refresh succeeds and the other fails.
- Both providers use the same model label or have different custom prices for that label.
- Calls are unpriced, explicitly priced at zero, or contain unavailable reasoning counts.
- Date boundaries, daylight-saving transitions, archive filtering and retained source history.
- A failed user-triggered request must clear the loading overlay and preserve saved rates.
- Changing views must not modify imported token records, prices, source logs or backups.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The top selector MUST offer All, ChatGPT and Claude without removing either existing view.
- **FR-002**: All token, call, session and period totals MUST equal the sum of identically filtered provider views.
- **FR-003**: Combined estimates MUST use each call's own provider and model rates, retaining custom-rate and unpriced-call counts.
- **FR-004**: The chart, filters, sorting, session details and exports MUST remain consistent in All.
- **FR-005**: Mixed session/model/pricing rows and exports MUST retain provider attribution.
- **FR-006**: Fetch pricing in All MUST refresh both providers, preserve each provider's saved rates on failure, and report partial success accurately.
- **FR-007**: Optional custom-rate edits from All MUST affect only the row's provider; no invented rates are allowed.
- **FR-008**: The All selection MUST persist, and loading feedback MUST clear after successful or failed requests.
- **FR-009**: Import health in All MUST include both providers without hiding available saved usage when one provider is missing.
- **FR-010**: Combined reporting MUST NOT change persisted usage, logs, backups or the repository's private-data exclusions.
- **FR-011**: Spec-Kit MUST be initialized in the application repository, with a completed constitution, baseline, feature design, tasks and validation record.

### Key Entities

- **Provider**: Claude or ChatGPT; All is a view over providers, not a third usage source.
- **Recorded call**: Usage belonging to a provider, session, model and timestamp.
- **Session**: A provider-attributed conversation with activity within the selected filters.
- **Model price**: A published or custom rate scoped to one provider and model.
- **Report selection**: Provider view, dates, timezone, grouping and user filters.
- **Engineering record**: Requirements, design decisions, tasks and acceptance evidence for a change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every combined integer count matches the sum of the provider counts exactly; estimated costs match to within one millionth of a US dollar before display rounding.
- **SC-002**: Every mixed session, model and pricing row identifies its provider, and exported sessions retain that attribution.
- **SC-003**: Switching between all three views, grouping periods, opening sessions and reloading preserve correct selections and clear loading feedback on success or failure.
- **SC-004**: All existing accounting and retention checks pass, and new checks demonstrate mixed pricing, missing data and partial fetch failure.
- **SC-005**: Local development setup reports zero missing managed files, and all eleven functional requirements have recorded validation evidence.

## Assumptions

- This adds a combined view over the currently supported local Codex and Claude Code logs;
  ordinary web chats, other devices and additional providers are outside this feature.
- Existing saved selections and the default provider remain compatible; All is optional.
- Current USD estimates remain API-equivalent values, not subscription invoices.
- The existing app architecture and chart presentation are retained unless the requirements require a change.
- Installing development tooling is accompanied by requirements and checks; it alone does not certify the app.
