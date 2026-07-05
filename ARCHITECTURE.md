# Architecture

## System goal

YNAB Control Panel automates personal budgeting workflows that YNAB does not natively express, while keeping every mutation explicit, auditable, and testable.

## Bird's-eye view

```text
Rules JSON + environment + scheduled CLI invocation
  ↓
parse boundaries → rule engine → YNAB adapter → audit log
  ↓
dry-run output or YNAB category budget updates
```

## Major components

### CLI

- Responsibility: provide human- and scheduler-runnable commands.
- Important boundary: dry-run is the default; mutation requires `--apply`.
- Read-only `list` helpers may expose full local YNAB names and IDs for rules configuration, but never call mutating adapter operations.
- What it must not own: budgeting math or YNAB response interpretation.

### Config parsing

- Responsibility: parse environment variables and rules JSON into domain types.
- Important boundary: external strings become domain values before reaching jobs or rule logic.
- What it must not own: job orchestration or YNAB calls.

### Rule engine

- Responsibility: pure budgeting calculations such as monthly category top-up planning.
- Important boundary: no network, filesystem, or clock access.
- What it must not own: YNAB SDK details or audit persistence.

### Jobs

- Responsibility: orchestrate parsed config, rule planning, YNAB reads/writes, and audit logging.
- Important boundary: idempotency is enforced before mutating YNAB.
- What it must not own: low-level SDK calls or domain parsing.

### YNAB adapter

- Responsibility: translate domain operations to the YNAB TypeScript SDK.
- Important boundary: SDK response shapes are converted to domain snapshots at the adapter edge.
- Read-only catalog helpers translate YNAB budget/category listings into copyable IDs for local config.
- What it must not own: rule math or scheduling policy.

### Audit log

- Responsibility: record applied mutations for safety and idempotency.
- Important boundary: monthly top-up claims and applications are keyed by rule and budget month.
- What it must not own: deciding how much to assign.

## Dependency or flow boundaries

- CLI depends on config, commands, and environment parsing.
- Commands construct adapters and call jobs.
- Jobs depend on domain logic through pure functions and on ports for YNAB/audit effects.
- Domain code must not depend on CLI, filesystem, YNAB SDK, or process environment.
- React frontend, when added, should call the same backend/domain capabilities rather than duplicating rule math.

## Stable invariants

- YNAB mutations require an explicit apply mode.
- Rule math remains pure and unit-testable.
- External data is parsed at boundaries before entering core logic.
- Integration-style job tests are the primary confidence layer for behavior that spans parsing, orchestration, idempotency, and adapter ports.
- Scheduled runs must be idempotent for a given rule/month.
- Apply runs claim a rule/month before mutating YNAB to prevent duplicate application if a process crashes after the YNAB update.

## Documentation architecture

- Shared language lives in: `CONTEXT.md`.
- Durable decisions live in: `docs/adr/`.
- Medium-term roadmap lives in: `ROADMAP.md`.
- Temporary implementation plans live in: `docs/plans/`.
- Engineering standards live in: `docs/guidelines/engineering-standards.md`.
- Agent workflow rules live in: `AGENTS.md`.
