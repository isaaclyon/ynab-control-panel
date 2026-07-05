# Engineering Standards

## Testing

- Required command surface:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm test`
  - `npm run test:coverage`
  - `npm run build`
- `npm run check` runs typechecking, linting, and formatting checks together.
- Live smoke surface, when `.env` has a YNAB token:
  - `npm run smoke:ynab`
- New or changed behavior should be covered by tests before implementation when practical.
- Integration tests have primacy for behavior crossing config parsing, job orchestration, YNAB ports, persistence, and idempotency.
- Pure domain calculations should also have focused unit tests.
- Coverage target: at least 90% statements, branches, functions, and lines.

## Typing

- TypeScript strict mode is required.
- `npm run typecheck` typechecks `src/`, `tests/`, `scripts/`, and Vitest config with strict TypeScript settings.
- Avoid unsafe casts. If a cast is needed at an external boundary, keep it local and convert into domain types immediately.
- Domain money values use YNAB milliunits, not floating-point dollars.

## Linting and formatting

- Biome owns linting and formatting.
- Run `npm run lint` for lint checks.
- Run `npm run format:check` to verify formatting and `npm run format` to apply formatting.

## Boundary design

- Parse, don't validate: external inputs are parsed into domain types at boundaries, then core code accepts those parsed types.
- Runtime config and secrets come from environment variables and local files that are ignored by git.
- YNAB SDK details stay behind adapter interfaces.
- YNAB-mutating jobs should claim audit/idempotency state before the external mutation and record completion after the mutation succeeds.

## Simplicity

- Avoid abstractions until there are at least two real call sites or slices that need them.
- Keep rule math pure and small.
- Prefer dry-run output and audit logs over hidden automation behavior.

## Change workflow

- Bug fixes should start with a regression test when practical.
- Material changes should get a lightweight review before completion.
- Update docs when terminology, boundaries, invariants, durable decisions, roadmap sequencing, or engineering rules change.
