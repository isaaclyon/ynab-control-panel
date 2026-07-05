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
- No-op and skip explanations in run output.
- Rules inspection CLI for local rules validation, listing, and explanation without YNAB calls.
- Docker-compatible runtime for mini PC scheduling.

## Next

Candidate vertical slices, roughly in priority order:

1. **Single-rule execution filter**: add `run rules --only <ruleId>` for safe dry-run-first testing and debugging of one rule.
2. **Budget execution filter**: add `run rules --budget <budgetId>` for running only rules that target one YNAB budget.
3. **Operation JSON output**: add `--json` for dry-run, apply, and audit outputs so scripts and future UI surfaces can consume structured operation diffs.
4. **Config examples generator**: generate starter JSON rule snippets from budget/category IDs to reduce config-editing mistakes.
5. **Rule-level notes or description field**: allow an optional human label/description in rules and surface it in output and audit history.
6. **Safe YNAB sandbox/dev-budget integration tests**: add opt-in tests against a real safe budget for listing, reading, and category budget updates.
7. **Audit recovery resolution notes**: append local records that mark claim-only operations as manually reviewed/resolved without pretending they were applied.
8. **Apply confirmation / plan file**: save a dry-run plan and apply that exact plan in a later command for stronger mutation review.
9. **Month rollover helper**: show current, previous, and next budget months and what month scheduled runs would target.
10. **End-of-month carryover workflow**: add a new rule type for moving remaining available money from selected categories into a holding category.
11. **Audit log compaction/export**: produce a compact local history/report without changing idempotency semantics.
12. **Stronger audit persistence**: add SQLite or another indexed store only if JSONL audit history becomes insufficient.

## Later

- Add a backend API and React frontend over the same domain model.
- Add a UI for rule editing, dry-run review, and run history.
