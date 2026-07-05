# YNAB Control Panel

Backend-first TypeScript utilities for safe YNAB automation. The first vertical slice is a CLI-managed monthly category top-up rule: assign up to `$X` in a month until a category balance reaches `$Y`.

## Current capability

- Load rules from JSON.
- List YNAB budget and category IDs for rules setup.
- Fetch category month state from YNAB.
- Calculate top-up assignments without mutating state by default.
- Apply changes only with `--apply`.
- Write an audit log for claimed/applied monthly top-ups so scheduled jobs are idempotent per rule/month.

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

List categories for a budget so you can copy a `categoryId` into `config/rules.json`:

```bash
npm run dev -- list categories --budget <budgetId>
```

The `list` commands are read-only. They intentionally print full local YNAB names and IDs without redaction because their purpose is copy/paste configuration on your own machine.

Dry-run the monthly top-up job:

```bash
npm run dev -- run top-up --month 2026-07
```

Apply the monthly top-up job:

```bash
npm run dev -- run top-up --month 2026-07 --apply
```

Scheduled entrypoint, intended for cron/systemd/Docker on the mini PC:

```bash
npm run dev -- run scheduled --apply
```

## Verification

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
```

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

If a run crashes, inspect `data/audit-log.jsonl`. A `monthly-category-top-up-claimed` record without a matching `monthly-category-top-up-applied` record means the app reserved that rule/month before or during a YNAB update; check YNAB before manually retrying.
