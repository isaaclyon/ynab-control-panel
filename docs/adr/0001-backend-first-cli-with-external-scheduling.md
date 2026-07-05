---
status: accepted
---

# ADR 0001 - Backend-first CLI with external scheduling

## Context

The app needs to run safely on a mini PC and mutate real YNAB budget state. The eventual product may include a React frontend, but the first useful slice is backend automation.

## Decision

Start with a TypeScript CLI and pure backend rule engine. Scheduled execution is external to the app, using host cron/systemd or Docker Compose invocations. The app exposes a `run scheduled` command but does not embed a long-running scheduler yet.

## Consequences

- The first slice can be tested and deployed without designing frontend/API surfaces prematurely.
- The mini PC can use standard scheduling and logging tools.
- Commands stay dry-run-first, and mutation requires `--apply`.
- A future frontend must sit over the backend/domain model rather than reimplementing rule math.

## Alternatives Considered

- Build the React frontend first: deferred because it would slow down the first automation slice and risks duplicating unsettled domain behavior.
- Embed cron in the app/container: deferred because host scheduling is simpler to inspect, restart, and recover on a personal mini PC.
