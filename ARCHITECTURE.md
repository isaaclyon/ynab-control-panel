# Architecture

## System goal

YNAB Control Panel automates personal budgeting workflows that YNAB does not natively express, while keeping every mutation explicit, auditable, and testable.

## Bird's-eye view

```text
Rules JSON + environment + scheduled CLI invocation
  ↓
parse boundaries → typed rule engine → planned budget operations
  ↓
job executor → YNAB adapter + operation audit log
  ↓
dry-run output or YNAB category budget updates
```

## Major components

### CLI

- Responsibility: provide human- and scheduler-runnable commands.
- Important boundary: dry-run is the default; mutation requires `--apply`.
- Read-only `list` helpers may expose full local YNAB names and IDs for rules configuration, but never call mutating adapter operations.
- Local `rules` inspection commands validate, list, and explain rules JSON without requiring a YNAB token or constructing a YNAB client.
- `run rules` and `run scheduled` execute all enabled budget rules by default and can be narrowed to one configured rule with `--only <ruleId>` or one YNAB budget with `--budget <budgetId>`. `run top-up` remains a compatibility alias for the same rules runner.
- Rule execution output is text-first: detailed per-operation lines are followed by a concise summary block for human review and cron/systemd logs.
- Run and audit commands also support opt-in structured JSON output; this is a presentation choice and does not change planning, mutation, or audit semantics.
- Run output enriches category IDs with YNAB category names from read-only catalog data before formatting and before writing generic operation audit claims.
- Run output includes a reason line for each operation or skipped disabled rule; these explanations are display text derived from domain reason codes and config state.
- `check scheduled` verifies scheduled-run readiness with read-only YNAB calls and local filesystem checks; it must not call mutating adapter operations.
- `carryover plan` is a dry-run-only assistant for previewing closing-month negative-balance cover moves and next-month mirror reversals; it reads YNAB category state but does not use audit state or expose apply mode.
- Read-only `audit` commands inspect local audit history without requiring a YNAB token or constructing a YNAB client.
- What it must not own: budgeting math or YNAB response interpretation.

### Config parsing

- Responsibility: parse environment variables and rules JSON into domain types.
- Important boundary: external strings become domain values before reaching jobs or rule logic.
- Rules config is a typed discriminated union, not a generic expression DSL.
- What it must not own: job orchestration or YNAB calls.

### Rule engine

- Responsibility: pure budgeting calculations that turn typed rules and category month snapshots into planned budget operations.
- Important boundary: no network, filesystem, or clock access.
- One enabled rule produces one planned budget operation with zero, one, or many category budget updates.
- What it must not own: YNAB SDK details or audit persistence.

### Jobs

- Responsibility: orchestrate parsed config, rule planning, YNAB reads/writes, and audit logging.
- Important boundary: idempotency is enforced before mutating YNAB.
- Apply mode claims an operation once, applies child category updates sequentially, then records the operation as applied.
- Claim-only audit state surfaces as pending recovery and is not automatically retried.
- Category names and rule descriptions on planned operations are optional display metadata; budget/rule/month IDs remain the audit and mutation boundary.
- What it must not own: low-level SDK calls or domain parsing.

### YNAB adapter

- Responsibility: translate domain operations to the YNAB TypeScript SDK.
- Important boundary: SDK response shapes are converted to domain snapshots at the adapter edge.
- Read-only catalog helpers translate YNAB budget/category listings into copyable IDs for local config.
- The mutating primitive is updating a category month's `budgeted` amount; multi-step budget operations call that primitive once per child update.
- What it must not own: rule math or scheduling policy.

### Audit log

- Responsibility: record operation claims and completions for safety and idempotency, and expose a read-only local scan model for recovery commands.
- Important boundary: operation audit is keyed by budget, rule, and budget month. Explicit audit scan commands surface a missing audit file as an error rather than treating it as empty.
- New writes use generic budget operation records. Legacy monthly top-up records are still read so old audit history prevents duplicate application.
- What it must not own: deciding how much to assign or transfer.

## Dependency or flow boundaries

- CLI depends on config, commands, and environment parsing.
- Commands construct adapters and call jobs.
- Jobs depend on domain logic through pure functions and on ports for YNAB/audit effects.
- Domain code must not depend on CLI, filesystem, YNAB SDK, or process environment.
- React frontend, when added, should call the same backend/domain capabilities rather than duplicating rule math.

## Stable invariants

- YNAB mutations require an explicit apply mode.
- Rule math remains pure and unit-testable.
- Carryover math remains pure and separate from YNAB reads; the command layer gathers category snapshots and formats the dry-run plan.
- External data is parsed at boundaries before entering core logic.
- Integration-style job tests are the primary confidence layer for behavior that spans parsing, orchestration, idempotency, and adapter ports.
- Scheduled runs must be idempotent for a given budget/rule/month.
- Apply runs claim a budget/rule/month before mutating YNAB to prevent duplicate application if a process crashes after the YNAB update.
- Multi-step budget operations are sequential, not atomic; operation-level audit is the recovery boundary. See ADR 0002.

## Documentation architecture

- Shared language lives in: `CONTEXT.md`.
- Durable decisions live in: `docs/adr/`.
- Medium-term roadmap lives in: `ROADMAP.md`.
- Temporary implementation plans live in: `docs/plans/`.
- Engineering standards live in: `docs/guidelines/engineering-standards.md`.
- Agent workflow rules live in: `AGENTS.md`.
