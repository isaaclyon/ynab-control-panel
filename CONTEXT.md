# YNAB Control Panel — Shared Context

## Language

**Budget month**: A YNAB month in `YYYY-MM` form. The CLI defaults to the current UTC month.

**YNAB month parameter**: The date-shaped month value YNAB API endpoints expect, in `YYYY-MM-01` form. The app accepts `Budget month` values at the CLI/domain boundary and converts them to YNAB month parameters inside the YNAB adapter.

**YNAB budget**: The top-level YNAB plan/budget whose ID is stored as `budgetId` in rules config. The YNAB SDK may call this a `planId`; this app uses `budgetId` in user-facing config and CLI output.

**Category month snapshot**: The YNAB state for one category in one budget month: budgeted, activity, and balance, represented in YNAB milliunits.

**Milliunits**: YNAB's integer money unit. `$1.00` is `1000` milliunits.

**Monthly category top-up rule**: A rule that assigns up to a configured monthly amount to a category until that category's balance reaches a configured target balance.

**Assignment amount**: The additional amount this app plans to budget for a category in a run. It is added to the current YNAB `budgeted` amount when applying.

**Dry-run**: A command mode that reads YNAB and prints planned changes without mutating YNAB or writing applied audit records. This is the default mode.

**Apply mode**: A command mode enabled by `--apply` that mutates YNAB and records applied mutations.

**Audit log**: Append-only local records of claimed and applied automations. The first implementation uses JSONL so scheduled CLI runs can avoid applying the same rule twice in a budget month.

## Relationships

- A monthly category top-up rule produces one assignment plan for one category in one budget month.
- The assignment amount is capped by both the configured monthly amount and the remaining gap to the target balance.
- The audit log supports idempotency; it is not the source of truth for current YNAB balances.
- Apply mode records a claim before mutating YNAB, then records the applied mutation after YNAB accepts the update. A claim without a matching applied record is a crash-recovery signal to inspect before retrying that rule/month.
