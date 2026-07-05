# Roadmap

## Now

- Backend-only TypeScript CLI.
- Typed budget rules engine.
- Monthly category top-up rule.
- Category available transfer rule.
- Dry-run-first execution and operation-level audit logging.
- Docker-compatible runtime for mini PC scheduling.

## Next

- Add stronger persistence if JSONL audit history becomes insufficient.
- Add more YNAB automation slices, such as end-of-month carryover workflows.
- Add category-name enrichment to operation output if category IDs are hard to review.
- Add integration tests around real YNAB sandbox/dev budget flows if a safe test budget is available.

## Later

- Add a backend API and React frontend over the same domain model.
- Add a UI for rule editing, dry-run review, and run history.
