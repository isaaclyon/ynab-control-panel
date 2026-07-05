# YNAB Control Panel

Backend-first TypeScript utilities for safe YNAB automation. The CLI runs typed budget rules in dry-run mode by default, then applies YNAB category budget updates only with `--apply`.

## Current capability

- Load typed rules from JSON.
- List YNAB budget and category IDs for rules setup.
- Inspect local rules JSON without requiring a YNAB token.
- Fetch category month state from YNAB.
- Plan monthly category top-ups.
- Plan category available transfers that move available money between categories by updating category `budgeted` amounts.
- Preview one user-visible planned operation per rule, even when that operation contains multiple YNAB updates.
- Filter run commands to one rule with `--only <ruleId>` for dry-run-first testing and debugging.
- Print text output by default and structured JSON with `--json` for run and audit commands.
- Apply changes only with `--apply`.
- Write an operation audit log so scheduled jobs are idempotent per budget/rule/month and claim-only runs are visible for manual recovery.
- Check scheduled-run readiness without mutating YNAB.

## Setup

```bash
npm install
cp .env.example .env
cp config/rules.example.json config/rules.json
```

Edit `.env` and `config/rules.json` with your YNAB access token, budget ID, and category IDs.

## CLI

List YNAB budgets so you can copy a `budgetId` into `config/rules.json`:

```bash
npm run dev -- list budgets
```

List categories for a budget so you can copy category IDs into `config/rules.json`:

```bash
npm run dev -- list categories --budget <budgetId>
```

The `list` commands are read-only. They intentionally print full local YNAB names and IDs without redaction because their purpose is copy/paste configuration on your own machine.

Inspect local rules JSON without contacting YNAB:

```bash
npm run dev -- rules validate
npm run dev -- rules list
npm run dev -- rules explain <ruleId>
```

Use `--rules <path>` on any `rules` inspection command to check a non-default rules file. These commands only parse local config; they do not require `YNAB_ACCESS_TOKEN` and do not read or mutate YNAB.

Dry-run all enabled budget rules:

```bash
npm run dev -- run rules --month 2026-07
```

Apply all enabled budget rules:

```bash
npm run dev -- run rules --month 2026-07 --apply
```

Run a single configured rule, dry-run first:

```bash
npm run dev -- run rules --month 2026-07 --only <ruleId>
npm run dev -- run rules --month 2026-07 --only <ruleId> --apply
```

`run rules`, `run top-up`, and `run scheduled` preserve detailed per-rule output and then print a summary block with rules considered, planned/applied operations, skipped/already-applied operations, no-ops, pending recovery, disabled rules, and the total dollars moved or budgeted in the current run. Each result includes a reason line explaining planned movement, no-ops, or disabled-rule skips. Category names are shown beside category IDs when the YNAB catalog lookup can resolve them; rules and audit identity remain ID-based.

Use `--json` on `run rules`, `run top-up`, or `run scheduled` to print structured results and the same summary for scripts or future UI surfaces:

```bash
npm run dev -- run rules --month 2026-07 --json
npm run dev -- run scheduled --apply --json
```

`run top-up` remains a compatibility alias for the generic rules runner:

```bash
npm run dev -- run top-up --month 2026-07
```

Scheduled entrypoint, intended for cron/systemd/Docker on the mini PC:

```bash
npm run dev -- run scheduled --apply
```

Check that the scheduled entrypoint is ready before enabling cron/systemd. This parses the environment and rules file, verifies the audit log path is writable, connects to YNAB, and reads the configured enabled rule categories for the target month without applying changes:

```bash
npm run dev -- check scheduled
npm run dev -- check scheduled --month 2026-07 --rules config/rules.json
```

Inspect pending recovery operations in the local audit log; this is read-only and does not require a YNAB token:

```bash
npm run dev -- audit status
npm run dev -- audit status --month 2026-07
```

Inspect one exact budget/rule/month audit key:

```bash
npm run dev -- audit inspect --budget <budgetId> --rule <ruleId> --month 2026-07
```

Use `--audit-log <path>` on either audit command to inspect a non-default JSONL file. Audit commands fail if the selected log file does not exist, so cron/systemd path mistakes do not look like an empty recovery queue. Audit output is local history only; compare with current YNAB before manually retrying a pending recovery operation.

Use `--json` on either audit command for structured local audit output:

```bash
npm run dev -- audit status --json
npm run dev -- audit inspect --budget <budgetId> --rule <ruleId> --month 2026-07 --json
```

## Rules JSON

Monthly category top-up:

```json
{
  "id": "emergency-fund-top-up",
  "type": "monthly-category-top-up",
  "description": "Build emergency fund to target",
  "budgetId": "budget-id",
  "categoryId": "category-id",
  "monthlyAmount": "250.00",
  "targetBalance": "1000.00"
}
```

Category available transfer:

```json
{
  "id": "sweep-dining-extra",
  "type": "category-available-transfer",
  "description": "Sweep extra dining money to vacation",
  "budgetId": "budget-id",
  "fromCategoryId": "dining-id",
  "toCategoryId": "vacation-id",
  "amount": { "type": "percent-of-available", "percent": 50, "max": "100.00" },
  "leaveAvailable": "25.00"
}
```

Transfer rules decrease the source category's `budgeted` amount and increase the destination category's `budgeted` amount. The source `budgeted` amount may become negative when moving carried-over available money, but the rule will not move more than the source available balance after `leaveAvailable`.

Set `enabled: false` on any rule to keep it in config without reading, writing, or auditing it.

Set optional `description` on any rule for human-readable output and audit history. Descriptions are display metadata only; rule IDs remain the durable identity for audit keys and YNAB mutations.

## Verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build
```

Use `npm run check` to run typechecking, linting, and formatting checks together. Use `npm run format` to apply Biome formatting.

Coverage is expected to stay at or above 90% for statements, branches, functions, and lines.

## Live smoke test

With `.env` configured, run a read-only YNAB connectivity and dry-run smoke test:

```bash
npm run smoke:ynab
```

The smoke test creates a temporary top-up rule against the first visible category in the first YNAB plan, runs in dry-run mode, redacts IDs/amounts in output, and never calls `--apply`.

## Deployment sketch

Build and run with Docker:

```bash
docker compose build
docker compose run --rm app run scheduled --apply
```

The app intentionally does not run an embedded scheduler yet. Prefer host cron or a systemd timer on the mini PC calling the Docker command above.

If a run crashes, use `audit status` or `audit inspect` instead of reading raw JSONL first. A `pending-recovery` entry means the app reserved that budget/rule/month before or during one or more YNAB updates; check YNAB before manually retrying.
