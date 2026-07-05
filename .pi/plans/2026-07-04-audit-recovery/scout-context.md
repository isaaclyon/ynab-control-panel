# Scout Context: Audit Recovery CLI Slice

## Goal
Plan read-only `audit status` / `audit inspect` commands that surface claim-only budget operations and their child updates without mutating YNAB.

## Source-of-truth constraints
- `CONTEXT.md`
  - Audit log is append-only and used for idempotency, not as YNAB source of truth.
  - Apply mode claims before mutation and records applied after all child updates succeed.
  - A claim without an applied record is a crash-recovery signal.
- `ARCHITECTURE.md`
  - Claim-only audit state is pending recovery and is not automatically retried.
  - Operation audit is keyed by budget, rule, and budget month.
- `docs/adr/0002-operation-level-audit-for-multi-step-budget-rules.md`
  - One planned operation may contain multiple child category updates.
  - The claim stores the full planned operation so a human can inspect recovery needs.

## Current audit model
File: `src/audit/auditLog.ts`

- Current record union supports both legacy top-up and generic operation records.
- Generic operation records:
  - `budget-operation-claimed`
  - `budget-operation-applied`
- Key shape:
  - `ruleId`
  - `budgetId`
  - `month`
- `getOperationState()` returns `none | claimed | applied`.
- `JsonlBudgetOperationAuditLog` reads legacy top-up records and normalizes generic operation claim records back into full `PlannedBudgetOperation` payloads.
- Important: `getOperationState()` currently only reports state; there is no public “list all claims for a month” or “inspect claim payload” API.

## Operation / claim payload shape
Files: `src/domain/budgetOperation.ts`, `src/jobs/runBudgetRules.ts`

`PlannedBudgetOperation` contains:
- `ruleId`, `ruleType`, `budgetId`, `month`
- `summary`, `reason`
- `updates[]` with `categoryId`, `budgetedBefore`, `budgetedAfter`, `delta`, optional `role`

Claims persist the full operation object in the JSONL line, so recovery can inspect child updates if the record is read back.

## Pending recovery semantics
File: `src/jobs/runBudgetRules.ts`

Apply flow inside `runExclusive(rule.id, month, ...)`:
1. read audit state with `getOperationState({ ruleId, budgetId, month })`
2. if `claimed`, return `skipped-pending-recovery`
3. if dry-run, return `dry-run`
4. append `budget-operation-claimed`
5. apply each non-zero child update sequentially
6. append `budget-operation-applied`

Implication for audit CLI:
- claim-only means “inspect manually before rerun”, not “safe to rerun automatically”.
- a read-only command should probably show the full planned operation and explicit recovery state, not just a boolean.

## CLI command patterns
File: `src/cli.ts`

- Commander-based CLI.
- Mutating entrypoints are under `run` and default to dry-run unless `--apply` is passed.
- Read-only listing commands live under `list` and intentionally print unredacted local IDs.
- Existing command wrappers are thin and dependency-injectable:
  - `src/commands/runRulesCommand.ts`
  - `src/commands/listYnabCommand.ts`
- Current output format style:
  - plain text
  - one top-level result per operation
  - status prefix + indented details
  - tabs only for `list` table output

## Output formatting patterns
Files: `src/jobs/runBudgetRules.ts`, `src/commands/listYnabCommand.ts`

- `formatBudgetRuleRunResults()` prints:
  - `status: ruleId (ruleType)`
  - `month`
  - summary line
  - one indented line per category update
- `list` commands print a privacy notice plus tab-separated tables.

For `audit status` / `audit inspect`, the simplest compatible shape is likely plain text with:
- state (`none|claimed|applied`)
- identifiers (`budgetId`, `ruleId`, `month`)
- operation summary/reason
- child updates with before/after/delta
- maybe claim/applied timestamps

## Config / env boundaries
Files: `src/config/env.ts`, `src/config/rules.ts`

- Required env: `YNAB_ACCESS_TOKEN`
- Defaults:
  - `YNAB_RULES_FILE=config/rules.json`
  - `YNAB_AUDIT_LOG_FILE=data/audit-log.jsonl`
- Rules config is parsed at the boundary and already supports heterogeneous rules:
  - `monthly-category-top-up`
  - `category-available-transfer`
- For a read-only audit CLI, config parsing is likely unnecessary unless the command resolves rule metadata from rules JSON.

## Test / coverage patterns
Files:
- `tests/audit/auditLog.test.ts`
- `tests/integration/runMonthlyCategoryTopUps.test.ts`
- `tests/commands/listYnabCommand.test.ts`
- `tests/commands/runTopUpsCommand.test.ts`

Relevant existing coverage:
- claim/applied state transitions
- duplicate-prevention
- pending-recovery skip after failed apply
- lock serialization
- generic operation records round-trip in JSONL

Gap for audit recovery slice:
- no test yet for listing/inspecting claim-only operations
- no test yet for filtering claims by month/budget/rule and formatting child updates

## Risks / design notes
1. **No list API yet**: current audit log can answer one key at a time; audit CLI likely needs a `find`/`list` method or direct file scan.
2. **Keying is strict**: state is keyed by `ruleId + budgetId + month`; CLI should surface budget ID explicitly to avoid ambiguity.
3. **Legacy records are asymmetric**: top-up claims/applies still exist, but new operation claims include full operation payload; audit views must handle both without assuming generic records only.
4. **No uncommitted diff found**: working tree is clean, so there is no visible uncommitted “extensible-rules” implementation to audit separately.
5. **Read-only guarantee**: audit commands should avoid loading YNAB clients unless they need live enrichment; local audit file inspection alone may be sufficient for status/inspect.

## Useful file refs
- `src/audit/auditLog.ts:8-72` record/state types and interface
- `src/audit/auditLog.ts:91-110` state queries
- `src/audit/auditLog.ts:140-317` JSONL parsing / legacy normalization
- `src/jobs/runBudgetRules.ts:45-97` claim/apply/recovery control flow
- `src/jobs/runBudgetRules.ts:108-125` current output formatting
- `src/cli.ts:13-53` command surface and style
