---
status: accepted
---

# ADR 0002 - Operation-level audit for multi-step budget rules

## Context

Some budget rules need to present one user-visible automation while applying multiple YNAB category `budgeted` updates. YNAB does not provide an atomic multi-category budget operation, so a process crash or API failure can leave only some child updates applied.

## Decision

Represent each enabled budget/rule/month as one planned budget operation. A planned operation may contain multiple category budget updates. Apply mode writes one operation claim before any child update, applies child updates sequentially through the YNAB adapter, and writes one operation applied record after all child updates succeed.

Claim-only operation audit state is treated as pending recovery and is not retried automatically. The claim stores the full planned operation so a human can inspect which child updates may need recovery.

## Consequences

- Dry-run and apply output match the user model: one rule produces one operation.
- Multi-step operations are not falsely presented as transactional.
- A failed multi-step apply is visible and recoverable instead of silently retried.
- Legacy monthly top-up audit records still block duplicate top-up application, but new writes use generic operation records.

## Alternatives Considered

- Fake a batch/transaction abstraction: rejected because YNAB does not provide atomic multi-category budget updates.
- Retry claim-only operations automatically: rejected because the prior run may have already applied only some child updates.
- Keep top-up-specific audit records only: rejected because they cannot describe multi-step operations or recovery state.
