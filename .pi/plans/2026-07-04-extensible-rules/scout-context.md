# Scout Context: Extensible Budget Rules Engine

## Request being planned
Design an extensible rules engine for YNAB budget automations that can go beyond native YNAB targets. The key product value is that multi-step YNAB primitives can be previewed/applied as one user-visible planned operation, e.g. “move up to X% or $X from available to budget,” while sharing standard rule fields/config.

## Current repo shape

Backend-first TypeScript CLI with strict TypeScript, Zod config parsing, Vitest, Biome, and YNAB SDK adapter.

Relevant files:

- `src/cli.ts` — Commander CLI; loads `.env` via `dotenv/config`.
- `src/commands/runTopUpsCommand.ts` — command wrapper that parses month, loads rules, creates YNAB client/audit log, runs top-up job, writes formatted output.
- `src/config/env.ts` — Zod parse boundary for env, including `YNAB_ACCESS_TOKEN`, rules file, audit log file.
- `src/config/rules.ts` — Zod parse boundary for current rules JSON.
- `src/domain/month.ts` — `BudgetMonth` parsing (`YYYY-MM`) and current UTC month.
- `src/domain/money.ts` — `Milliunits`, dollar amount parsing/formatting.
- `src/domain/monthlyCategoryTopUp.ts` — current pure rule math.
- `src/jobs/runMonthlyCategoryTopUps.ts` — orchestration across rule config, YNAB port, audit log, dry-run/apply.
- `src/audit/auditLog.ts` — JSONL audit log and file lock for idempotency.
- `src/ynab/budgetClient.ts` — YNAB port(s): category month read/update and read-only catalog list.
- `src/ynab/ynabBudgetClient.ts` — YNAB SDK adapter.
- `tests/integration/runMonthlyCategoryTopUps.test.ts` — primary cross-boundary confidence for job/dry-run/apply/idempotency.

Docs/constraints:

- `CONTEXT.md` owns domain language.
- `ARCHITECTURE.md` owns boundaries/invariants.
- `docs/guidelines/engineering-standards.md` says integration tests have primacy for behavior crossing config parsing, job orchestration, YNAB ports, persistence, and idempotency.
- Mutating commands are dry-run by default; `--apply` required for YNAB mutation.
- Domain rule math must remain pure and isolated from YNAB SDK.
- Maintain 90% coverage threshold.

## Current domain/config model

`src/config/rules.ts` currently only parses one rule variant:

```ts
export type RulesConfig = {
  readonly rules: readonly MonthlyCategoryTopUpRule[];
};
```

Rule schema fields:

- `id: string`
- `type: "monthly-category-top-up"`
- `budgetId: string`
- `categoryId: string`
- `monthlyAmount: dollarAmount > 0`
- `targetBalance: dollarAmount >= 0`

The parser converts string dollar amounts to YNAB milliunits. This is a parse-don’t-validate boundary.

## Current monthly top-up rule

`src/domain/monthlyCategoryTopUp.ts` defines:

- `MonthlyCategoryTopUpRule`
- `CategoryMonthSnapshot` with `budgeted`, `activity`, `balance`
- `MonthlyCategoryTopUpPlan`
- `planMonthlyCategoryTopUp(...)`

Pure planning behavior:

- needed amount = max(targetBalance - snapshot.balance, 0)
- assignment amount = min(monthlyAmount, needed)
- budgetedAfter = snapshot.budgeted + assignmentAmount
- no side effects
- reason = `target-already-met` or `top-up-needed`

Important terminology: current code treats category `balance` as available balance in YNAB milliunits.

## Current job/orchestration model

`src/jobs/runMonthlyCategoryTopUps.ts`:

- iterates `config.rules`
- for each rule, reads category month snapshot via `budgetClient.getCategoryMonth({ budgetId, month, categoryId })`
- computes a plan via pure function
- skips no-op plans
- uses `auditLog.runExclusive(rule.id, month, ...)`
- checks `hasClaimedOrApplied(rule.id, month)`
- dry-run returns status without audit writes or YNAB mutation
- apply mode:
  1. append claimed audit record
  2. call `budgetClient.updateCategoryBudgeted(...)`
  3. append applied audit record
- returns `TopUpRunResult[]`
- formats a text summary with status, category, month, balance/target, assignment, budgeted before/after

Statuses currently:

- `dry-run`
- `applied`
- `skipped-already-claimed`
- `skipped-no-op`

## Current audit/idempotency model

`src/audit/auditLog.ts` is top-up-specific:

- record union: `monthly-category-top-up-claimed` and `monthly-category-top-up-applied`
- keyed by `ruleId` and `BudgetMonth`
- records include one category, assignment amount, budgetedAfter, timestamp
- `JsonlTopUpAuditLog` stores JSONL records
- `hasClaimedOrApplied(ruleId, month)` returns true if any record exists for that rule/month
- `runExclusive(ruleId, month, operation)` uses a lock file derived from rule/month

This works for single-category, single-update plans. It is not yet expressive enough for multi-step operations where one user-visible rule expands into multiple YNAB updates.

Planning implication: multi-step rules need a more generic operation/audit model. The current “claim before first mutation, applied after last mutation” pattern can be generalized, but crash recovery should clearly signal partial application. Because YNAB does not provide an atomic multi-category transfer endpoint, multi-step apply cannot be truly transactional; it can only be audited, serialized, and recoverable.

## Current YNAB ports/adapters

`src/ynab/budgetClient.ts`:

```ts
export interface BudgetClient {
  getCategoryMonth(input: { budgetId; month; categoryId }): Promise<CategoryMonthSnapshot>;
  updateCategoryBudgeted(input: { budgetId; month; categoryId; budgeted }): Promise<void>;
}
```

Also has read-only catalog port for listing budgets/categories.

`src/ynab/ynabBudgetClient.ts`:

- converts `BudgetMonth` to YNAB month parameter (`YYYY-MM-01`)
- `getMonthCategoryById` maps SDK response to domain snapshot
- `updateMonthCategory` updates the category `budgeted` amount
- `listBudgets()` uses `plans.getPlans(false)`
- `listCategories()` uses `categories.getCategories`, filtering internal/deleted groups/categories and flagging hidden categories

Planning implication: a “move available between categories” will probably require reading at least two category snapshots and applying two `updateCategoryBudgeted` calls: decrease source budgeted, increase target budgeted. The port may need a batch-ish method or an operation applier that still calls update one-by-one internally.

## Current CLI commands

`src/cli.ts`:

- `list budgets` — read-only helper, unredacted local names/IDs for config setup
- `list categories --budget <budgetId>` — read-only helper
- `run top-up [--month] [--rules] [--apply]`
- `run scheduled [--month] [--rules] [--apply]` currently delegates to top-up job

`runTopUpsCommand` is top-up-specific; likely needs renaming/generalization if rules become heterogeneous.

## Tests and confidence patterns

Important existing tests:

- `tests/config/rules.test.ts` — config parse behavior
- `tests/domain/monthlyCategoryTopUp.test.ts` — pure rule math
- `tests/integration/runMonthlyCategoryTopUps.test.ts` — dry-run, apply once, skip already claimed, overlapping apply lock, no-op formatting
- `tests/commands/runTopUpsCommand.test.ts` — command wiring
- `tests/ynab/ynabBudgetClient.test.ts` — adapter mapping/update/list behavior
- `tests/audit/auditLog.test.ts` — audit persistence/locking/parse behavior

New rule engine work should preserve this pattern:

- unit tests for pure planning logic
- integration tests for heterogeneous config + job orchestration + audit + YNAB port effects
- adapter tests only if YNAB port changes
- command tests for renamed/generalized commands

## Current tooling

- `npm run typecheck` => `tsc -p tsconfig.typecheck.json`
- `npm run lint` => `biome lint .`
- `npm run format:check` => `biome format .`
- `npm test`, `npm run test:coverage`, `npm run build`
- `npm run check` = typecheck + lint + format check only

Strict TS applies to `src`, `tests`, `scripts`, and `vitest.config.ts`.

## Existing docs language to update if plan lands

`CONTEXT.md` currently defines:

- Budget month
- YNAB month parameter
- YNAB budget
- Category month snapshot
- Milliunits
- Monthly category top-up rule
- Assignment amount
- Dry-run
- Apply mode
- Audit log

Likely new/changed terms:

- Budget rule / rule envelope
- Planned budget operation
- Category budget update / budget delta
- Multi-step operation
- Available sweep / category transfer
- Amount policy (fixed, percent-of-available, min/max, leave floor)
- Claim/applied records for operation-level idempotency

`ARCHITECTURE.md` currently says bird’s-eye view is `parse boundaries → rule engine → YNAB adapter → audit log`; this can survive but should be refined around generic planned operations.

## Planning risks / design questions

1. **Avoid a generic DSL too early.** Prefer a typed discriminated union of rule variants plus shared primitives/envelope.
2. **Shared fields/config.** Good candidates: `id`, `type`, `enabled?`, `budgetId`, maybe optional description. Month likely remains command-level rather than per-rule at first.
3. **Amount policies.** Need decide scope. Minimal first set for transfer could be fixed and percent-of-available with optional max and leaveAvailable floor. Avoid deeply composable math expressions initially.
4. **Available transfer semantics.** YNAB has budgeted/activity/balance. To “move available” from source to target, likely reduce source category `budgeted` and increase target category `budgeted`. Must not move more than source `balance - leaveAvailable`; also probably cap by source `budgeted`? This needs product/YNAB semantics clarification because reducing budgeted below current activity may create negative available.
5. **Multiple writes are not atomic.** A transfer requires two YNAB updates. Need operation-level audit that records claimed before writes and applied after all writes; maybe include planned updates in the claim for manual recovery if crash occurs mid-apply.
6. **Idempotency key.** Current key is rule/month. That likely remains default. If future rules can run more than once per month, need separate recurrence/run key, but avoid now unless required.
7. **Generic job naming.** Current `runMonthlyCategoryTopUps` and `runTopUpsCommand` are specific. A likely target is `runBudgetRules` / `runRulesCommand`, with current `run top-up` preserved as a narrow entrypoint or implemented via generic engine.
8. **Audit migration/backcompat.** Existing audit records are top-up-specific. Since repo is early, planner should decide whether to preserve old record parsing or migrate to a generic audit record. User did not request backward compatibility, but safety around existing `data/audit-log.jsonl` matters if already used locally.
9. **Output.** The output should summarize one rule as one planned operation and list child updates under it, e.g. “move $62.50 from Dining to Vacation” plus budgeted before/after for each category.
10. **Read model efficiency.** Multi-category plans need snapshots for all referenced categories. Simplicity first: read per rule; optimize/dedupe later only if needed.

## Suggested target architecture direction

A modest, extensible design could introduce:

- `BudgetRule` discriminated union with shared envelope fields.
- `AmountPolicy` discriminated union for reusable amount calculations.
- `CategoryMonthSnapshot` moved from top-up-specific module to a more generic domain/YNAB port location.
- `PlannedBudgetOperation` as the central rule output:
  - operation id/rule id/type/budget/month
  - status/reason/title/summary
  - readonly list of `CategoryBudgetUpdate` items with categoryId, budgetedBefore, budgetedAfter, delta
  - maybe source snapshots/metadata for formatting
- Rule-specific planners that are pure and return `PlannedBudgetOperation`.
- Generic job executor that:
  1. reads snapshots needed by a rule
  2. creates operation plan
  3. skips no-op
  4. locks by rule/month
  5. checks operation audit
  6. dry-runs or applies all updates sequentially
  7. records claim/applied around the operation
- Generic audit records containing full planned operation/update list for recovery.

Potential new rule variant:

```json
{
  "id": "sweep-dining-extra",
  "type": "category-available-transfer",
  "enabled": true,
  "budgetId": "budget-id",
  "fromCategoryId": "dining-id",
  "toCategoryId": "vacation-id",
  "amount": { "type": "percent-of-available", "percent": 50, "max": "100.00" },
  "leaveAvailable": "25.00"
}
```

Potential dry-run output:

```text
dry-run: sweep-dining-extra
  move $62.50 from dining-id to vacation-id
  month: 2026-07
  dining-id budgeted: $300.00 -> $237.50
  vacation-id budgeted: $125.00 -> $187.50
```

## Likely implementation phases

1. Introduce shared rule envelope/types and generic planned operation model while preserving existing top-up behavior.
2. Generalize config parsing to a discriminated union but keep `monthly-category-top-up` accepted.
3. Generalize job/audit execution around planned operations, initially with top-up only.
4. Add `category-available-transfer` rule and amount policy support.
5. Update CLI/docs/output and add integration tests covering multi-step dry-run/apply/crash-recovery signal.

## Must preserve

- Dry-run default; mutation only with `--apply`.
- Parse-don’t-validate at config/env boundaries.
- Pure domain math.
- YNAB SDK isolated behind adapter/port.
- Integration tests as primary confidence for orchestration/audit/port behavior.
- 90% coverage threshold and strict TypeScript/Biome checks.
