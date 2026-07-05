# YNAB Control Panel

Backend-first TypeScript utilities for safe YNAB automation. The first vertical slice is a CLI-managed monthly category top-up rule: assign up to `$X` in a month until a category balance reaches `$Y`.

## Current capability

- Load rules from JSON.
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

## Deployment sketch

Build and run with Docker:

```bash
docker compose build
docker compose run --rm app run scheduled --apply
```

The app intentionally does not run an embedded scheduler yet. Prefer host cron or a systemd timer on the mini PC calling the Docker command above.

If a run crashes, inspect `data/audit-log.jsonl`. A `monthly-category-top-up-claimed` record without a matching `monthly-category-top-up-applied` record means the app reserved that rule/month before or during a YNAB update; check YNAB before manually retrying.
