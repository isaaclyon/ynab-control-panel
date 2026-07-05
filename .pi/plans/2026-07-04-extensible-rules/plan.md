# 2026-07-04 — Extensible budget rules engine plan

Status: implemented  
Owner: agent  
Tag: `extensible-rules`

## Understanding

- Extend the current single-purpose monthly category top-up path into a typed budget rules engine where one rule produces one user-visible planned budget operation.
- A planned budget operation may contain one or many YNAB primitive category budget updates, but dry-run/apply output and audit/idempotency should treat it as one operation.
- The first new rule to prove the engine is a category available transfer: “move up to X% or $X from one category’s available balance to another category’s budgeted amount.”
- The current code is intentionally backend-first: Zod parses external config, pure domain functions plan budget math, jobs orchestrate YNAB/audit side effects, and CLI commands stay dry-run-first.

## Relevant Context

- `CONTEXT.md:15-17`: current language is top-up-specific: a top-up rule produces one assignment amount for one category.
- `CONTEXT.md:23-30`: audit log claims before mutation and treats claim-without-applied as a crash-recovery signal.
- `ARCHITECTURE.md:32-42`: rule math belongs in pure domain code; jobs orchestrate planning, YNAB reads/writes, and audit persistence.
- `ARCHITECTURE.md:65-72`: explicit apply mode, parse boundaries, integration test primacy, per-rule/month idempotency, and claim-before-mutate are stable invariants.
- `docs/guidelines/engineering-standards.md:15-18`: new behavior should be test-first where practical; integration tests are primary for config/job/port/audit behavior; coverage must stay at least 90%.
- `docs/guidelines/engineering-standards.md:33-44`: parse-don’t-validate, YNAB SDK isolation, claim-before-mutate, pure small rule math, and visible dry-run/audit behavior are required.
- `src/config/rules.ts:6-20`: config currently parses only `monthly-category-top-up`; `RulesConfig.rules` is not yet a heterogeneous union.
- `src/domain/monthlyCategoryTopUp.ts:13-17`: `CategoryMonthSnapshot` is currently defined in a top-up-specific module even though it is the shared YNAB category month read model.
- `src/domain/monthlyCategoryTopUp.ts:32-53`: current top-up planning is pure and should remain the model for new rule planners.
- `src/jobs/runMonthlyCategoryTopUps.ts:23-74`: the job currently plans and applies exactly one category update per rule and writes top-up-specific claim/applied audit records.
- `src/jobs/runMonthlyCategoryTopUps.ts:82-95`: output is top-up-specific and cannot show one operation with child updates.
- `src/audit/auditLog.ts:7-35`: audit records and API are top-up-specific and only store one category/budgeted-after value.
- `src/ynab/budgetClient.ts:5-17`: the existing YNAB port already exposes the primitive needed for multi-step operations: read category month and update category budgeted.
- `src/cli.ts:30-48`: CLI run commands are top-up-specific except `run scheduled`, which currently delegates to the top-up path.

## Assumptions / Open Questions

- Assumption: idempotency remains `ruleId + budgetMonth` for now. Rules that need multiple applications in the same month are out of scope.
- Assumption: budget month remains command-level, not per-rule config.
- Assumption: “available” means YNAB category `balance` from `CategoryMonthSnapshot`.
- Assumption: a transfer is implemented by decreasing the source category’s `budgeted` and increasing the destination category’s `budgeted`; no YNAB transaction/activity is created.
- Assumption to confirm: source `budgetedAfter` may become negative when moving carried-over available money, as long as source available after transfer stays at or above `leaveAvailable`. If this is not acceptable, cap transfer amount by `max(source.budgeted, 0)`.
- Assumption: first amount policies are `fixed` and `percent-of-available` with optional `max`; no generic DSL/expression language.
- Assumption: output may use category IDs initially. Resolving category names is useful but not needed for the first engine slice.
- Open question before implementation: should a claim-only audit state surface as a distinct `skipped-pending-recovery` status? Recommendation: yes, because multi-step applies are non-atomic and a plain “already claimed” hides recovery work.

## Recommended Approach

### Chosen approach

Use a modest typed-discriminated-union rules engine, not a generic rules DSL.

Introduce:

- A shared rule envelope: `id`, `type`, `budgetId`, optional `enabled` defaulting to `true`.
- `BudgetRule = MonthlyCategoryTopUpRule | CategoryAvailableTransferRule`.
- A reusable `AmountPolicy` union for `fixed` and `percent-of-available` policies.
- A generic `PlannedBudgetOperation` containing one user-visible operation and its child `CategoryBudgetUpdate[]`.
- Rule-specific pure planners that return `PlannedBudgetOperation`.
- A generic job executor that reads needed snapshots, calls the rule-specific planner, skips no-ops, checks audit state, dry-runs, or applies each child update sequentially.
- Operation-level JSONL audit records that include the full planned operation/update list for manual recovery.

### Why this is the right level of change

- It creates exactly the extension seam needed by the second rule variant while preserving strict typed config and pure rule math.
- It avoids a premature DSL, plugin registry, database, or batch YNAB abstraction.
- It keeps the existing YNAB port primitive (`updateCategoryBudgeted`) because YNAB does not provide an atomic multi-category budget operation.
- It makes the product value explicit: one rule → one planned operation → many primitive updates under that operation.

### Tradeoffs considered

- **Typed union vs. generic DSL**: choose typed union. A DSL is more flexible but would weaken parse-time guarantees and add complexity before there are enough rule variants.
- **Sequential child updates vs. fake transaction/batch API**: choose sequential updates with operation-level audit. YNAB has no atomic multi-category operation; pretending otherwise would hide failure modes.
- **Generic planner registry vs. `switch(rule.type)`**: start with a switch in the job/domain dispatcher. A registry can come later if rule count grows.
- **Backward-compatible audit parsing vs. clean break**: read legacy top-up audit records for idempotency, but write only new generic operation records. This avoids accidentally reapplying already-run local automations.
- **Cap transfer by available vs. current budgeted**: recommend capping by available after leave-floor, not current `budgeted`, so carried-over available can be moved. Confirm before implementation.

### Target domain model sketch

```ts
type BudgetRuleBase = {
  readonly id: string;
  readonly type: string;
  readonly budgetId: string;
  readonly enabled: boolean;
};

type BudgetRule = MonthlyCategoryTopUpRule | CategoryAvailableTransferRule;

type AmountPolicy =
  | { readonly type: "fixed"; readonly amount: Milliunits }
  | { readonly type: "percent-of-available"; readonly percent: number; readonly max?: Milliunits };

type CategoryBudgetUpdate = {
  readonly categoryId: string;
  readonly budgetedBefore: Milliunits;
  readonly budgetedAfter: Milliunits;
  readonly delta: Milliunits;
  readonly role?: "primary" | "source" | "destination";
};

type PlannedBudgetOperation = {
  readonly ruleId: string;
  readonly ruleType: BudgetRule["type"];
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly summary: string;
  readonly updates: readonly CategoryBudgetUpdate[];
  readonly reason: string;
};
```

Keep exact type names flexible during implementation, but preserve the concepts above.

### Target transfer config

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

Transfer amount calculation:

1. `movableAvailable = max(fromSnapshot.balance - leaveAvailable, 0)`.
2. `policyAmount = fixed amount` or `floor(movableAvailable * percent / 100)`, then cap by optional `max`.
3. `transferAmount = min(movableAvailable, policyAmount)`.
4. Source update: `budgetedAfter = fromSnapshot.budgeted - transferAmount`.
5. Destination update: `budgetedAfter = toSnapshot.budgeted + transferAmount`.
6. If `transferAmount === 0`, return a no-op planned operation and do not write audit/apply records.

## Implementation Steps

1. **Add shared domain primitives**
   - Move or re-export `CategoryMonthSnapshot` from the top-up module into a shared domain module, e.g. `src/domain/categoryMonth.ts`.
   - Add `CategoryBudgetUpdate` and `PlannedBudgetOperation` in a focused module, e.g. `src/domain/budgetOperation.ts`.
   - Update `BudgetClient` imports only; do not change YNAB adapter behavior.

2. **Introduce the rule envelope and heterogeneous config parsing**
   - Define `BudgetRule` and shared rule fields in domain/config-facing types.
   - Update `src/config/rules.ts` to parse a Zod discriminated union on `type`.
   - Keep `monthly-category-top-up` accepted with the same fields.
   - Add `enabled` with default `true`.
   - Enforce unique rule IDs at parse time to prevent audit/idempotency collisions.
   - Parse `category-available-transfer` and `AmountPolicy`; reject same source/destination category and invalid percent/max/leave values.

3. **Wrap current top-up planning as a planned operation**
   - Preserve the existing pure top-up math, either by keeping `planMonthlyCategoryTopUp` and adding an adapter to `PlannedBudgetOperation`, or by changing it to return the generic operation shape while keeping tests equivalent.
   - Ensure a top-up operation has one `CategoryBudgetUpdate` with role `primary` and a zero-delta/no-op representation for target-already-met.

4. **Add pure transfer planning**
   - Create `src/domain/categoryAvailableTransfer.ts`.
   - Implement amount policy calculation and transfer planning using only parsed domain values and category snapshots.
   - Unit-test fixed amount, percent amount, max cap, leaveAvailable floor, no-op, rounding down, and the chosen negative-source-budgeted behavior.

5. **Generalize audit to operation-level records**
   - Rename types/classes toward `BudgetOperationAuditLog` / `JsonlBudgetOperationAuditLog` or add new generic types and leave compatibility exports temporarily.
   - Write new records with kinds like `budget-operation-claimed` and `budget-operation-applied`.
   - Store `ruleId`, `ruleType`, `budgetId`, `month`, timestamp, and the full planned operation/update list in the claim; store enough in applied records to prove completion.
   - Replace `hasClaimedOrApplied` with an operation-state method that can distinguish `none`, `claimed`, and `applied`.
   - Preserve legacy top-up record parsing so existing JSONL logs still block duplicate top-up application.
   - Keep lock behavior based on `ruleId + month`; note cross-rule/category concurrency as a known risk rather than solving it prematurely.

6. **Replace the top-up job with a generic budget-rule job**
   - Add `runBudgetRules` and `formatBudgetRuleRunResults`.
   - Iterate enabled rules and dispatch by `rule.type`.
   - Read only snapshots needed for each rule.
   - Skip no-op operations before audit writes/mutations.
   - For apply mode: claim once, apply each non-zero `CategoryBudgetUpdate` sequentially via `updateCategoryBudgeted`, then append applied once.
   - On claim-only audit state, skip and print a recovery-oriented status instead of silently retrying.
   - Keep exceptions from failed YNAB updates loud; do not auto-rollback or auto-retry partial operations.

7. **Update CLI command wiring**
   - Add/rename command wrapper to `runRulesCommand`.
   - Make `run scheduled` call the generic job.
   - Add a `run rules` command for all enabled budget rules.
   - Decide whether `run top-up` remains as a compatibility alias. Recommendation: keep it temporarily but describe it as a legacy alias for the generic rules runner, or remove it if breaking local scripts is acceptable.

8. **Update output formatting**
   - Print one status block per planned operation.
   - Include rule ID/type, month, summary, and child category budget updates.
   - Example:

   ```text
   dry-run: sweep-dining-extra (category-available-transfer)
     month: 2026-07
     move $62.50 from dining-id to vacation-id
     dining-id budgeted: $300.00 -> $237.50 (-$62.50)
     vacation-id budgeted: $125.00 -> $187.50 (+$62.50)
   ```

9. **Update docs once implementation lands**
   - `CONTEXT.md`: add/adjust durable terms for budget rule, rule envelope, planned budget operation, category budget update, category available transfer, amount policy, and operation-level audit.
   - `ARCHITECTURE.md`: update rule engine/job/audit descriptions to planned operations and sequential child updates.
   - `ROADMAP.md`: move extensible rules/category transfer from “Next” into “Now” or mark completed, depending on implementation state.
   - Consider an ADR for “multi-step rules apply sequential YNAB updates under operation-level audit” because it is durable, surprising without context, and driven by a real YNAB atomicity tradeoff.

## Verification

- Config tests:
  - Existing top-up config still parses.
  - Mixed top-up + transfer config parses into domain milliunits.
  - `enabled` defaults to `true`.
  - Duplicate rule IDs are rejected.
  - Invalid amount policies, negative leave floors, and identical source/destination categories are rejected.
- Domain tests:
  - Existing top-up planning behavior remains equivalent.
  - Transfer fixed amount moves the expected budgeted delta from source to destination.
  - Transfer percent amount respects percent, `max`, and `leaveAvailable`.
  - Transfer no-ops when movable available is zero.
  - Percent rounding never transfers more than available.
- Audit tests:
  - Generic claimed/applied records are persisted and read back.
  - Claim-only state is distinguishable from applied state.
  - Legacy top-up records still block duplicate rule/month application.
  - Existing lock serialization and stale-lock behavior still pass.
- Integration tests:
  - Dry-run mixed rules produce operation summaries without YNAB writes or audit writes.
  - Apply top-up remains one YNAB update and one operation claim/applied pair.
  - Apply transfer performs exactly two `updateCategoryBudgeted` calls under one operation status and one operation claim/applied pair.
  - Second apply skips by audit state.
  - Simulated failure after the first transfer child update leaves a claim record with the full planned operation and causes the next run to surface pending recovery without retrying.
  - Disabled rules do not read, write, or audit.
  - CLI `run rules` / `run scheduled` defaults to dry-run and wires env/config/client/audit correctly.
- Full checks before completion:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm test`
  - `npm run test:coverage`
  - `npm run build`

## Risks

- **Partial multi-step apply**: YNAB updates are not atomic. A crash or API failure after one child update can leave the budget partially changed. Mitigate with pre-mutation operation claims that include every planned child update, no automatic retry, and a visible pending-recovery status.
- **Ambiguous transfer semantics**: capping by available but allowing negative source `budgeted` may surprise users. Confirm this before implementation and encode the decision in tests/docs.
- **Cross-rule races**: current locks are per rule/month, not per category or budget/month. Concurrent processes running different rules that touch the same categories can still race. Do not solve in the first slice unless this is a real scheduling risk; document that scheduled apply should run as a single process, or add a coarse budget/month apply lock if needed.
- **Audit compatibility**: dropping legacy top-up audit parsing could reapply already-run rules. Preserve legacy read compatibility even if new writes use operation-level records.
- **Output clarity**: category IDs are precise but less readable. Category name lookup can be added later if output proves hard to review.
- **Premature abstraction**: adding registries, plugins, expression DSLs, batch ports, or rollback logic now would obscure the simple typed extension seam. Keep the first engine slice explicit and test-backed.

## Implementation Todos (`extensible-rules`)

- `[extensible-rules]` Add shared category snapshot and budget operation domain types.
- `[extensible-rules]` Generalize rules config to a typed union with shared envelope fields.
- `[extensible-rules]` Convert monthly top-up planning/output to `PlannedBudgetOperation`.
- `[extensible-rules]` Add category available transfer config, amount policies, and pure planner.
- `[extensible-rules]` Generalize audit records/state to operation-level claims/applied records with legacy read compatibility.
- `[extensible-rules]` Add generic `runBudgetRules` executor and operation formatter.
- `[extensible-rules]` Wire CLI `run rules` / scheduled path to the generic executor.
- `[extensible-rules]` Add unit/integration/command/audit tests listed above.
- `[extensible-rules]` Update context, architecture, roadmap, and possibly ADR after implementation.
