# YNAB Control Panel — Shared Context

## Language

**Budget month**: A YNAB month in `YYYY-MM` form. The CLI defaults to the current UTC month.

**YNAB month parameter**: The date-shaped month value YNAB API endpoints expect, in `YYYY-MM-01` form. The app accepts `Budget month` values at the CLI/domain boundary and converts them to YNAB month parameters inside the YNAB adapter.

**YNAB budget**: The top-level YNAB plan/budget whose ID is stored as `budgetId` in rules config. The YNAB SDK may call this a `planId`; this app uses `budgetId` in user-facing config and CLI output.

**Category month snapshot**: The YNAB state for one category in one budget month: budgeted, activity, and balance, represented in YNAB milliunits. This app treats `balance` as the category's available balance.

**Milliunits**: YNAB's integer money unit. `$1.00` is `1000` milliunits.

**Budget rule**: A typed automation rule in rules JSON. Every rule has a shared envelope (`id`, `type`, `budgetId`, optional `enabled`) and rule-specific fields.

**Planned budget operation**: The user-visible result of planning one enabled budget rule for one budget month. One planned operation may contain one or many category budget updates.

**Category budget update**: A planned YNAB category `budgeted` change with before/after values and a delta. Category budget updates are the primitive YNAB mutations used by budget operations.

**Monthly category top-up rule**: A budget rule that assigns up to a configured monthly amount to a category until that category's balance reaches a configured target balance.

**Category available transfer rule**: A budget rule that moves available money from one category to another by decreasing the source category's `budgeted` amount and increasing the destination category's `budgeted` amount. The transfer is capped by the source available balance after `leaveAvailable`; source `budgeted` may become negative when moving carried-over available money.

**Amount policy**: A typed rule field that calculates how much money a rule may move. The first policies are fixed amount and percent of available with an optional maximum.

**Assignment amount**: The additional amount this app plans to budget for a category in a monthly top-up operation. It is added to the current YNAB `budgeted` amount when applying.

**Dry-run**: A command mode that reads YNAB and prints planned operations without mutating YNAB or writing applied audit records. This is the default mode.

**Apply mode**: A command mode enabled by `--apply` that mutates YNAB and records applied operations.

**Scheduled-run health check**: A read-only command that verifies the configured scheduled run can parse its environment and rules, write beside the audit log path, connect to YNAB, and read enabled rule categories without mutating YNAB.

**Rule execution summary**: A concise text block printed after detailed `run rules` / `run scheduled` operation output. It counts rules considered, dry-run planned operations, applied operations, already-applied skips, no-op operations, pending-recovery operations, disabled rules skipped before planning, and the total dollars planned/applied in the current run.

**Category-name enrichment**: Run output loads category names from the YNAB category catalog and prints them alongside category IDs. Rules, audit keys, and domain math remain ID-based; audit output shows names only when they were captured in the claimed operation payload.

**Run reason**: A human-readable explanation printed with each run result. It translates rule planning reason codes into why money will move or why a rule was no-op/skipped, such as target already met, source available at the leaveAvailable floor, amount policy rounded to zero, or disabled rule.

**Rules inspection command**: A local-only command under `rules` that validates, lists, or explains rules JSON without requiring a YNAB token and without reading or mutating YNAB.

**Audit log**: Append-only local records of claimed and applied budget operations. JSONL audit records let scheduled CLI runs avoid applying the same budget/rule/month twice and let read-only audit commands surface claim-only runs for manual recovery.

## Relationships

- One enabled budget rule produces at most one planned budget operation for one budget month.
- A planned budget operation may contain multiple category budget updates, but output and audit treat it as one operation.
- The monthly top-up assignment amount is capped by both the configured monthly amount and the remaining gap to the target balance.
- The category available transfer amount is capped by the source category's available balance after `leaveAvailable` and by its amount policy.
- The audit log supports idempotency; it is not the source of truth for current YNAB balances.
- Apply mode records an operation claim before mutating YNAB, then records the operation as applied after all child updates succeed. A claim without a matching applied record is a crash-recovery signal to inspect before retrying that budget/rule/month.
- The scheduled-run health check is operational readiness evidence only; it does not reserve audit state or prove future YNAB balances will produce a non-no-op operation.
- Rule execution summaries count transfers by positive child update deltas so moving money between categories is reported once, not once per source and destination update.
- Category names are display metadata. Category IDs remain the durable identity for rules, audit idempotency, and YNAB mutations.
- Disabled rules are reported as skipped run results without reading YNAB, writing audit records, or mutating YNAB.
- Rules inspection commands stop at config parsing and formatting; they do not plan operations because planning depends on current YNAB category month snapshots.
