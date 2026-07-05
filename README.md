# YNAB Control Panel

Backend-first TypeScript utilities for safe YNAB automation. The CLI runs typed budget rules in dry-run mode by default, then applies YNAB category budget updates only with `--apply`.

## Current capability

- Load typed rules from JSON.
- List YNAB budget and category IDs for rules setup.
- Fetch category month state from YNAB.
- Plan monthly category top-ups.
- Plan category available transfers that move available money between categories by updating category `budgeted` amounts.
- Preview one user-visible planned operation per rule, even when that operation contains multiple YNAB updates.
- Apply changes only with `--apply`.
- Write an operation audit log so scheduled jobs are idempotent per budget/rule/month and claim-only runs are visible for manual recovery.

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

Dry-run all enabled budget rules:

```bash
npm run dev -- run rules --month 2026-07
```

Apply all enabled budget rules:

```bash
npm run dev -- run rules --month 2026-07 --apply
```

`run top-up` remains a compatibility alias for the generic rules runner:

```bash
npm run dev -- run top-up --month 2026-07
```

Scheduled entrypoint, intended for cron/systemd/Docker on the mini PC:

```bash
npm run dev -- run scheduled --apply
```

## Rules JSON

Monthly category top-up:

```json
{
  "id": "emergency-fund-top-up",
  "type": "monthly-category-top-up",
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
  "budgetId": "budget-id",
  "fromCategoryId": "dining-id",
  "toCategoryId": "vacation-id",
  "amount": { "type": "percent-of-available", "percent": 50, "max": "100.00" },
  "leaveAvailable": "25.00"
}
```

Transfer rules decrease the source category's `budgeted` amount and increase the destination category's `budgeted` amount. The source `budgeted` amount may become negative when moving carried-over available money, but the rule will not move more than the source available balance after `leaveAvailable`.

Set `enabled: false` on any rule to keep it in config without reading, writing, or auditing it.

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

If a run crashes, inspect `data/audit-log.jsonl`. A `budget-operation-claimed` record without a matching `budget-operation-applied` record means the app reserved that budget/rule/month before or during one or more YNAB updates; check YNAB before manually retrying.
