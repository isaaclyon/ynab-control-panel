# Agent Guide

## Source-of-truth order

When documents disagree, resolve them in this order:

1. `CONTEXT.md` for canonical language
2. current ADRs for durable decisions
3. `ARCHITECTURE.md` for synthesized current system shape
4. `ROADMAP.md` for medium-term sequencing
5. `docs/plans/` for temporary implementation state
6. `docs/guidelines/` for engineering standards
7. this file for agent/dev workflow rules

Do not let agent instructions invent domain concepts, architecture, or decisions that are missing from the owning docs.

## Workflow rules

- Keep YNAB-mutating commands dry-run-first unless an ADR changes this.
- Preserve parse-don't-validate boundaries.
- Keep domain rule math pure and isolated from the YNAB SDK.
- Add or update integration tests for behavior crossing job orchestration, adapter ports, and persistence.
- Maintain the 90% coverage threshold.

## Before finishing material work

Check whether the change created a documentation delta:

- new or changed terminology?
- new or changed boundary/invariant?
- new durable decision?
- roadmap or implementation-plan status change?
- new engineering or agent workflow rule?
- new enforcement seam that deserves an ADR reference?

Update the owning file before claiming the work is complete.
