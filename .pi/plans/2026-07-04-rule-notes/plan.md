# 2026-07-04 — Rule descriptions in output and audit history

Status: implemented  
Tag: `rule-notes`  
Owner: agent

## Understanding

- Add an optional human-readable rule label/description, parse it from rules JSON, and surface it in human/JSON command output and audit history.
- Current rule config and domain types carry only `id`, `type`, `enabled`, `budgetId`, and rule-specific fields; there is no display-only rule metadata.
- The safest audit path is to carry the description on `PlannedBudgetOperation`, because generic audit claims already persist the full operation payload.

## Relevant Context

- `CONTEXT.md:15`: defines the budget rule envelope; this should be updated once the field lands.
- `CONTEXT.md:37` and `ARCHITECTURE.md:56`: category names are display metadata and IDs remain durable. Treat rule descriptions the same way.
- `ROADMAP.md:23-27`: rule-level notes/description is an explicit candidate vertical slice.
- `docs/adr/0002-operation-level-audit-for-multi-step-budget-rules.md:13-16`: claim records store the planned operation for audit/recovery; putting the description on the operation reuses this decision.
- `src/config/rules.ts:12-20` and `src/config/rules.ts:38-48`: Zod schemas parse each rule type and currently have no optional description field.
- `src/domain/monthlyCategoryTopUp.ts:6-14` and `src/domain/categoryAvailableTransfer.ts:19-28`: rule types need the new optional field.
- `src/domain/budgetOperation.ts:16-24`: planned operations need the optional field so run JSON and audit payloads can carry it.
- `src/jobs/runBudgetRules.ts:73-89`: disabled rules are skipped before planning, so their run result needs its own optional description copy.
- `src/jobs/runBudgetRules.ts:119-127`: apply mode writes the whole planned operation in the claim record.
- `src/jobs/runBudgetRules.ts:209-228`: run text formatting is the main runtime output surface.
- `src/commands/rulesCommand.ts:75-115`: rules list/explain formatting is the local config inspection surface.
- `src/audit/auditLog.ts:16-24`, `src/audit/auditLog.ts:67-79`, and `src/audit/auditLog.ts:401-416`: generic claims, audit scan entries, and audit type guards need to tolerate/preserve the optional field.
- `src/commands/auditCommand.ts:114-140`: audit text formatting needs an explicit description line when a claim payload has one.
- `README.md:117-148` and `config/rules.example.json:3-20`: rule examples should document the field.

## Assumptions / Open Questions

- Assumption: implement one optional string field named `description`. If the user prefers `note`/`notes`, this is a mechanical rename before coding; do not support multiple aliases in the first slice.
- Assumption: a configured description must be non-empty after trimming. Omit the field when there is no description.
- Assumption: descriptions are display metadata only. They must not affect rule math, YNAB mutation inputs, audit/lock keys, duplicate prevention, or summaries.
- Assumption: text output should sanitize tabs/newlines to spaces so a long/freeform description cannot break table or log shape.
- Assumption: “command output” covers `rules list`, `rules explain`, `run rules`/`run top-up`/`run scheduled`, and `audit status`/`audit inspect`, including existing `--json` payloads. `check scheduled` only reports health-check counts and should not grow per-rule description output in this slice.
- Todo tools are unavailable in this environment, so tagged implementation todos are included below.

## Recommended Approach

- Add `description?: string | undefined` to both rule types and `PlannedBudgetOperation`, parse it at the rules-config boundary, and copy it from rule to planned operation in each pure planner.
- Add `description?: string | undefined` to `DisabledBudgetRuleRunResult`, because disabled rules do not produce a planned operation.
- Render a single optional `description: ...` line in run and audit text output, and add a `description` column/line to rules inspection output.
- Let structured JSON output expose the same field naturally through existing result, operation, and audit scan objects.

Why this is the right level of change:

- It preserves parse-don't-validate boundaries and keeps rule math pure.
- It avoids a separate audit field that could drift from the claimed operation payload.
- It keeps the metadata display-only and does not introduce a naming/label abstraction or multiple user-facing aliases.

Material alternative rejected:

- Add `description` directly to audit records/entries outside `operation`. This duplicates the operation payload and does not help legacy/applied-only records, which still cannot have details that were never claimed.

## Implementation Steps

1. Add failing/targeted tests first:
   - config parsing accepts trimmed `description` on both rule types, omits it when absent, and rejects blank descriptions;
   - rules list/explain show descriptions and sanitize table cells;
   - top-up and transfer planned operations copy `rule.description`;
   - run formatting shows descriptions for planned/applied/no-op/audit-skipped operations and disabled-rule results;
   - run JSON includes operation/result descriptions through existing output objects;
   - audit scan preserves `operation.description` from persisted claims, old claims without descriptions still scan, and non-string persisted descriptions are ignored as malformed;
   - audit text/JSON output shows descriptions when claim payloads contain them.
2. Update `src/config/rules.ts`:
   - add a small `ruleDescriptionSchema = z.string().trim().min(1, "description cannot be blank").optional()`;
   - include it in both rule schemas;
   - keep ID uniqueness and all money parsing unchanged.
3. Update domain types:
   - add optional `description` to `MonthlyCategoryTopUpRule`, `CategoryAvailableTransferRule`, and `PlannedBudgetOperation`;
   - use `?: string | undefined` to stay friendly with Zod optional output under `exactOptionalPropertyTypes`.
4. Thread descriptions through pure planners:
   - add `description: input.rule.description` or an equivalent conditional spread in `planMonthlyCategoryTopUpOperation()` and `planCategoryAvailableTransfer()`;
   - do not change summaries, reasons, updates, or amount calculations.
5. Update `src/jobs/runBudgetRules.ts`:
   - include `description` on skipped-disabled results;
   - add a shared formatting helper for optional descriptions and use it in `formatBudgetRuleRunResult()`;
   - confirm `enrichOperationCategoryNames()` preserves descriptions via the existing object spread.
6. Update audit parsing and formatting:
   - update `isPlannedBudgetOperation()` in `src/audit/auditLog.ts` to require absent-or-string `description`;
   - no new audit record kind or key field is needed;
   - add the optional description line in `formatOperationDetails()` before summary/reason lines;
   - keep legacy top-up and applied-only output tolerant of missing operation details.
7. Update rules inspection formatting:
   - add a final `description` column in `formatRulesList()` with sanitized blank output when absent;
   - add an optional `description: ...` line to `formatRuleExplanation()` common lines;
   - preserve “No YNAB calls were performed.” behavior.
8. Update examples and docs after code/tests are passing:
   - `config/rules.example.json`: include `description` examples;
   - `README.md`: document the optional field and note it is display-only/audit-visible;
   - `CONTEXT.md`: update the budget rule envelope and add a short rule-description/display-metadata relationship;
   - `ARCHITECTURE.md`: mention rule descriptions alongside category-name display metadata if the implementation surfaces that boundary clearly;
   - `ROADMAP.md`: remove or mark the rule-level notes item as completed/now.
9. Run targeted checks, then required repo checks.

## Tagged Implementation Todos

- [x] `[rule-notes]` Add rule-description config parsing tests and schema support.
- [x] `[rule-notes]` Add optional description fields to rule and planned-operation domain types.
- [x] `[rule-notes]` Copy descriptions through top-up and transfer operation planners.
- [x] `[rule-notes]` Surface descriptions in run results, disabled skips, and run JSON/text tests.
- [x] `[rule-notes]` Preserve and validate descriptions in audit claim scan parsing.
- [x] `[rule-notes]` Surface descriptions in audit status/inspect text and JSON tests.
- [x] `[rule-notes]` Surface descriptions in rules list/explain output.
- [x] `[rule-notes]` Update config examples and owning docs/roadmap.
- [x] `[rule-notes]` Run targeted and full verification commands.

## Verification

- Targeted implementation loop:
  - `npx vitest run tests/config/rules.test.ts tests/domain/monthlyCategoryTopUp.test.ts tests/domain/categoryAvailableTransfer.test.ts tests/jobs/runBudgetRules.test.ts tests/audit/auditLog.test.ts tests/commands/rulesCommand.test.ts tests/commands/auditCommand.test.ts`
- Targeted integration checks if CLI/doc output changes are touched:
  - `npx vitest run tests/integration/rulesCli.test.ts tests/integration/auditCli.test.ts tests/integration/runMonthlyCategoryTopUps.test.ts`
- Required repo checks before completion:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm test`
  - `npm run test:coverage`
  - `npm run build`

## Risks

- Field-name ambiguity (`description` vs `note`/`notes`): confirm before implementation if the user cares about JSON field naming; otherwise proceed with `description`.
- Audit compatibility: older claim payloads and legacy top-up records lack descriptions. Keep the field optional everywhere and only print it when present.
- Persisted malformed descriptions: update the audit type guard so bad external JSONL lines do not enter typed audit history.
- Output noise from long/freeform text: sanitize to one line in text output and put the column last in `rules list`.
- Accidental identity drift: tests/docs should make clear descriptions are not part of audit keys, lock keys, or YNAB mutations.
