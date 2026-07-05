# Roadmap

## Now

- Backend-only TypeScript CLI.
- Typed budget rules engine.
- Monthly category top-up rule.
- Category available transfer rule.
- Dry-run-first execution and operation-level audit logging.
- Read-only audit recovery CLI for local claim/apply history.
- Scheduled-run health check for env, rules, audit path, and YNAB read connectivity.
- Rule execution summary for dry-run/apply/scheduled output.
- Category-name enrichment for operation and audit output while preserving ID-based rules and domain math.
- Rule descriptions in command output and audit history while preserving ID-based rules and audit identity.
- No-op and skip explanations in run output.
- Dry-run carryover assistant for previewing closing-month negative-balance cover moves and next-month mirror reversals.
- Rules inspection CLI for local rules validation, listing, and explanation without YNAB calls.
- Structured JSON output for run and audit commands.
- Single-rule execution filter for dry-run-first testing and debugging.
- Budget execution filter for running one YNAB budget's configured rules.
- Docker-compatible runtime for mini PC scheduling.

## Next

Candidate vertical slices, roughly in priority order:

1. **Config examples generator**: generate starter JSON rule snippets from budget/category IDs to reduce config-editing mistakes.
2. **Audit recovery resolution notes**: append local records that mark claim-only operations as manually reviewed/resolved without pretending they were applied.
3. **Apply confirmation / plan file**: save a dry-run plan and apply that exact plan in a later command for stronger mutation review.
4. **Month rollover helper**: show current, previous, and next budget months and what month scheduled runs would target.
5. **End-of-month carryover apply workflow**: decide whether carryover plans should become applyable plan files, audited one-off operations, or a configured rule type.
6. **Audit log compaction/export**: produce a compact local history/report without changing idempotency semantics.

## Later

- Add a backend API and React frontend over the same domain model.
- Add a UI for rule editing, dry-run review, and run history.
