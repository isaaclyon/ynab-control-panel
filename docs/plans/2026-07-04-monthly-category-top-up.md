# 2026-07-04 — Monthly category top-up slice

Status: complete
Owner: agent

## Goal

Scaffold a backend-first TypeScript CLI that can dry-run or apply monthly category top-up rules against YNAB.

## Non-goals

- React frontend.
- Embedded long-running scheduler.
- Editing rules through a UI.
- Real YNAB sandbox budget fixtures.

## Source-of-truth inputs

- Context: `CONTEXT.md`
- ADRs: `docs/adr/0001-backend-first-cli-with-external-scheduling.md`
- Architecture: `ARCHITECTURE.md`
- Guidelines: `docs/guidelines/engineering-standards.md`

## Verification

- `npm run typecheck`
- `npm test`
- `npm run test:coverage`
- `npm run build`
- `docker compose config`
