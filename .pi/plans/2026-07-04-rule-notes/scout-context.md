# Rule notes/description scout context

## Repo shape
- `src/config/rules.ts`: parses rules JSON into domain rules via Zod.
- `src/domain/*.ts`: typed rule and planning logic.
- `src/jobs/runBudgetRules.ts`: orchestrates rule planning, dry-run/apply, audit, and output formatting.
- `src/commands/*.ts`: CLI surfaces for `run`, `audit`, `rules`, `list`, `check`.
- `src/audit/auditLog.ts`: JSONL audit persistence + scan formatting.
- Tests mirror those layers under `tests/...`.

## Current rule model
- `src/domain/monthlyCategoryTopUp.ts` and `src/domain/categoryAvailableTransfer.ts` define the two rule types.
- `src/domain/budgetRule.ts` is the union.
- `src/config/rules.ts` schema currently allows only the shared envelope: `id`, `type`, `enabled`, `budgetId`, plus rule-specific fields.
- No existing human label/description field is present in domain types or schema.

## Data flow / parse boundary
- External JSON is parsed in `parseRulesConfig()` before entering jobs or domain logic (`src/config/rules.ts`).
- Parsed rules become strongly typed domain objects; jobs never re-parse config.
- This matches CONTEXT/ARCHITECTURE guidance: parse at the boundary, keep rule math pure.

## CLI/output surfaces that would need the note
### Rules inspection
- `src/commands/rulesCommand.ts`
  - `formatRulesList()` prints `ruleId`, `type`, `enabled`, `budgetId`, `categories`.
  - `formatRuleExplanation()` prints the selected rule fields and effect text.
- Likely to add the note to both list/explain output.

### Run output
- `src/jobs/runBudgetRules.ts`
  - `formatBudgetRuleRunResult()` prints status, rule id/type, month, summary, reason, and category updates.
  - `runBudgetRules()` carries only the typed rule into planning and result shaping.
- If surfaced in run output, the note probably needs to be attached to `PlannedBudgetOperation` and threaded into formatting here.

### Audit output/history
- `src/audit/auditLog.ts`
  - claimed audit record stores the full `PlannedBudgetOperation` payload.
  - `formatAuditEntry()` prints operation summary, reason, and updates from that payload.
  - Persisted scan model exposes `operation?: PlannedBudgetOperation`.
- Because audit history rehydrates claim payloads, adding the note to `PlannedBudgetOperation` should automatically make it available in audit output, but tests/formatters likely need explicit display text.

## Existing patterns to preserve
- Dry-run is default; mutation only on `--apply` (`src/commands/runRulesCommand.ts`, `src/jobs/runBudgetRules.ts`).
- Disabled rules are skipped before YNAB reads/audit writes.
- Output is text-first with optional JSON for run/audit commands.
- Category names are display metadata only; IDs remain durable identifiers.
- Audit idempotency keys are budget/rule/month, not names/labels.
- Parse-don't-validate boundary is important; schema changes should happen in `src/config/rules.ts` and domain types together.

## Likely files to change
- `src/config/rules.ts` — accept optional note field in schema.
- `src/domain/monthlyCategoryTopUp.ts`, `src/domain/categoryAvailableTransfer.ts`, `src/domain/budgetRule.ts` — add field to rule types.
- `src/domain/budgetOperation.ts` and/or planning functions if notes should be present in planned operations and audit payloads.
- `src/jobs/runBudgetRules.ts` — ensure note is preserved and displayed.
- `src/commands/rulesCommand.ts` — show note in `rules list` / `rules explain`.
- `src/commands/auditCommand.ts` and/or `src/audit/auditLog.ts` — show note in audit history output.
- `config/rules.example.json` and README rules section — document the new field.
- Tests under `tests/config`, `tests/commands`, `tests/jobs`, `tests/audit`, plus integration tests if output changes.

## Notes on audit/history
- Current audit claims store the planned operation object, so the safest way to surface the note in history is to include it on `PlannedBudgetOperation` (not as a separate audit field) and keep it read-only/display-only.
- Legacy monthly top-up audit records do not have full operation payloads; any new display should tolerate missing note for old records.
