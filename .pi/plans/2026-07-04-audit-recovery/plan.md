# 2026-07-04 — Audit recovery CLI vertical slice

Status: implemented  
Tag: `audit-recovery`  
Owner: agent

## Understanding

- Add a read-only audit recovery CLI surface, likely `audit status` plus `audit inspect`, so a user can find claim-only budget operations and inspect their planned child category updates after a crash or partial multi-step apply.
- Current code already records the right recovery data for generic operations: `budget-operation-claimed` stores the full `PlannedBudgetOperation`, and `budget-operation-applied` completes the state for the same budget/rule/month key.
- Current gap: the public audit API only answers one key's state and does not expose a scan/list/read model for pending claims or claim payload inspection.

## Relevant Context

- `CONTEXT.md:33-42`: audit log is append-only/idempotency-oriented, not YNAB source of truth; claim-without-applied is the recovery signal.
- `ARCHITECTURE.md:21-27`: CLI owns human/scheduler command surfaces, not budgeting math or YNAB interpretation.
- `ARCHITECTURE.md:43-49`: jobs treat claim-only audit state as pending recovery and do not retry automatically.
- `ARCHITECTURE.md:59-64`: audit is keyed by budget, rule, and budget month; legacy top-up records still matter.
- `docs/adr/0002-operation-level-audit-for-multi-step-budget-rules.md:13-22`: operation-level claim/apply is the recovery boundary; claim stores the planned operation for human inspection.
- `src/audit/auditLog.ts:59-69`: current audit key/interface exposes `getOperationState()` but no list/inspect method.
- `src/audit/auditLog.ts:91-106`: current state semantics are `applied` if any applied record exists, else `claimed` if any claim exists, else `none`.
- `src/audit/auditLog.ts:190-317`: JSONL parsing already accepts generic operation and legacy top-up records and normalizes milliunits.
- `src/jobs/runBudgetRules.ts:45-97`: apply claims before any child update, skips claim-only state as `skipped-pending-recovery`, then appends applied only after all child updates succeed.
- `src/jobs/runBudgetRules.ts:106-119`: current human output style is plain text, one operation per block, status prefix plus indented details.
- `src/cli.ts:12-58`: commander command groups are thin; `run` can mutate only with `--apply`; `list` is read-only.
- `src/config/env.ts:9-22`: current env parser always requires `YNAB_ACCESS_TOKEN`, which audit-only local inspection should not require.
- `README.md:26-64` and `README.md:135`: README currently documents CLI commands and tells users to inspect raw `data/audit-log.jsonl` after a crash.

## Assumptions / Open Questions

- Assumption: implement both commands in the same vertical slice because `status` finds pending recovery entries and `inspect` provides exact-key detail. If scope must shrink, implement `audit status` first with a verbose enough output to inspect child updates.
- Assumption: audit commands inspect only the local audit JSONL file. They should not construct a YNAB client, parse rules JSON, fetch category names, or mutate YNAB.
- Assumption: `audit status` defaults to pending recovery (`claimed`) entries, with optional filters; `audit inspect` requires the full key and can report `none`, `claimed`, or `applied`.
- Assumption: generic operation claims are the canonical source for planned child updates. Legacy top-up records should be surfaced honestly with limited detail rather than fabricated into a full modern operation.
- Open question for implementation only if desired: whether `audit status` needs a flag such as `--all`/`--include-applied`. It is useful but not required for the recovery slice if `audit inspect` can report applied state for an exact key.
- Todo tools are unavailable in this environment, so tagged implementation todos are included below.

## Recommended Approach

### Chosen design

Add a local audit read model and a thin CLI command wrapper:

1. Extend `src/audit/auditLog.ts` with read-only scan types and a public scan method on `JsonlBudgetOperationAuditLog`, without adding it to the existing `BudgetOperationAuditLog` write/idempotency interface.
2. Add `src/commands/auditCommand.ts` with dependency-injectable `auditStatusCommand()` and `auditInspectCommand()` functions plus plain-text formatters.
3. Add a top-level `audit` command group in `src/cli.ts`:
   - `audit status [--month <yyyy-mm>] [--budget <budgetId>] [--rule <ruleId>] [--audit-log <path>]`
   - `audit inspect --month <yyyy-mm> --budget <budgetId> --rule <ruleId> [--audit-log <path>]`
4. Add an audit-only env parser so these commands can read `YNAB_AUDIT_LOG_FILE` defaulting to `data/audit-log.jsonl` without requiring `YNAB_ACCESS_TOKEN`.
5. Update README recovery instructions after implementation lands.

### Why this is the right level of change

- It keeps recovery read-only and local, which matches the audit log's role and avoids implying that the log is current YNAB truth.
- It reuses the audit parser/normalizer instead of duplicating JSONL scanning in the command layer.
- It avoids widening the existing job-facing `BudgetOperationAuditLog` interface, so test fakes used by run/apply paths do not need unrelated read-model methods.
- It keeps output consistent with existing run output and avoids a structured output/API commitment before there is a frontend.

### Command/API/output tradeoffs

- **Local audit scan vs live YNAB enrichment**: choose local scan. Live enrichment would require a token/client and could blur planned operation data with current YNAB state.
- **Audit read model vs direct command file scan**: choose audit read model. Direct scan duplicates record parsing and risks divergence from idempotency semantics.
- **Separate reader interface vs adding methods to `BudgetOperationAuditLog`**: choose separate reader/scan surface. The job interface should stay focused on idempotency and appends.
- **`status` default all records vs pending-only**: choose pending-only by default. The recovery problem is claim-only operations; `inspect` covers exact-key state checks.
- **Legacy normalization into fake operations vs limited legacy output**: choose limited legacy output. Legacy records do not contain summary/reason/full update context, so the CLI should say that.
- **Malformed audit lines ignored vs warning**: keep scheduled-run tolerance, but the read model should count ignored/malformed non-empty lines so audit commands can warn instead of giving false confidence.

### Suggested read model shape

Keep names flexible, but the implementation should support this shape:

```ts
export type OperationAuditEntry = {
  readonly key: OperationAuditKey;
  readonly state: Exclude<OperationAuditState, "none">;
  readonly ruleType?: PlannedBudgetOperation["ruleType"];
  readonly claimedAt?: string;
  readonly appliedAt?: string;
  readonly operation?: PlannedBudgetOperation;
  readonly legacyTopUp?: {
    readonly categoryId: string;
    readonly assignmentAmount: Milliunits;
    readonly budgetedAfter: Milliunits;
  };
};

export type OperationAuditEntryFilter = {
  readonly ruleId?: string;
  readonly budgetId?: string;
  readonly month?: BudgetMonth;
  readonly state?: Exclude<OperationAuditState, "none">;
};

export type OperationAuditScan = {
  readonly entries: readonly OperationAuditEntry[];
  readonly ignoredLineCount: number;
};
```

Grouping rules should match `getOperationState()`:

- group by strict `ruleId + budgetId + month`;
- `applied` wins over `claimed`;
- use the latest claim payload/timestamp in file order for display;
- include generic applied-only records as applied entries with no operation payload;
- represent legacy top-up records as monthly-top-up legacy detail, not as full modern operations.

### Suggested output

`audit status` when pending entries exist:

```text
pending-recovery: transfer-1 (category-available-transfer)
  budgetId: budget-1
  month: 2026-07
  claimedAt: 2026-07-01T00:00:00.000Z
  move $50.00 from source to destination
  reason: transfer-needed
  source source budgeted: $100.00 -> $50.00 (-$50.00)
  destination destination budgeted: $10.00 -> $60.00 (+$50.00)
```

`audit status` when no pending entries match:

```text
No pending recovery operations found.
```

`audit inspect` exact key with no records:

```text
none: rule-1
  budgetId: budget-1
  month: 2026-07
  no audit records found for this budget/rule/month
```

If ignored/malformed lines are detected, append a warning line to either command output:

```text
Warning: 1 audit log line could not be parsed and was ignored.
```

## Implementation Steps

1. Add a small audit-only env parser in `src/config/env.ts`, e.g. `parseAuditEnv()` returning `{ auditLogFile }`, with tests proving it does not require `YNAB_ACCESS_TOKEN`.
2. Add read-model scan types and `scanOperationAuditEntries(filter)` to `src/audit/auditLog.ts` on `JsonlBudgetOperationAuditLog`.
3. Refactor the private JSONL read path just enough to share parsing between existing `readRecords()` and the new scan method while preserving current duplicate-prevention behavior.
4. Implement grouping/filtering in the scan method with existing `getOperationState()` precedence: applied wins, then claimed.
5. Add audit-log unit tests for generic claim-only entries, applied entries, strict budget/rule/month filters, legacy top-up limited output, and ignored-line counts.
6. Add `src/commands/auditCommand.ts` with `auditStatusCommand()`, `auditInspectCommand()`, option parsing, and formatters.
7. Add command tests that verify:
   - `audit status` defaults to claim-only/pending recovery entries;
   - filters are parsed and passed as domain `BudgetMonth` values;
   - child updates render before/after/delta and roles when present;
   - `audit inspect` reports `none` for an exact missing key;
   - no YNAB client or rules config dependency is involved.
8. Wire `audit status` and `audit inspect` in `src/cli.ts` using `parseAuditEnv(process.env)`, not `parseEnv(process.env)`.
9. Update README CLI/recovery docs to point users at the new audit commands instead of raw JSONL inspection. If the implementation introduces a new durable boundary statement, update `ARCHITECTURE.md`; no ADR change is expected because ADR 0002 already owns the recovery decision.
10. Run the targeted verification first, then the repo-required checks.

## Tagged Implementation Todos

- [x] `[audit-recovery]` Add audit-only env parsing and tests.
- [x] `[audit-recovery]` Add audit scan/read-model types and JSONL grouping tests.
- [x] `[audit-recovery]` Implement audit command formatters and command tests.
- [x] `[audit-recovery]` Wire commander subcommands without requiring YNAB token/client.
- [x] `[audit-recovery]` Update README recovery instructions.
- [x] `[audit-recovery]` Run targeted and full verification commands.

## Verification

- Targeted test loop during implementation:
  - `npx vitest run tests/config/env.test.ts tests/audit/auditLog.test.ts tests/commands/auditCommand.test.ts`
- Required repo checks before completion:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm test`
  - `npm run test:coverage`
  - `npm run build`
- Optional manual smoke after build with a temporary JSONL file:
  - `YNAB_AUDIT_LOG_FILE=/tmp/audit.jsonl npm run dev -- audit status --month 2026-07`
  - `YNAB_AUDIT_LOG_FILE=/tmp/audit.jsonl npm run dev -- audit inspect --budget budget-1 --rule transfer-1 --month 2026-07`

## Design Validation

- The command surface is read-only by construction: it parses env/options, reads the JSONL audit file, and formats local records.
- Recovery semantics stay aligned with ADR 0002: claim-only means inspect before retry, not auto-retry.
- The strict budget/rule/month key is visible in every output block, reducing ambiguity when multiple budgets or reused rule IDs exist.
- The plan avoids category-name enrichment because that would require live YNAB reads and is already a separate roadmap idea.
- The plan avoids a durable ADR because it implements accepted ADR 0002 rather than choosing a new hard-to-reverse architecture.

## Risks

- **False confidence from malformed JSONL**: mitigate by counting ignored lines and warning in audit output.
- **Legacy records lack full child-update context**: surface them, but label detail as limited; do not pretend they have generic-operation summaries/reasons.
- **Applied record without claim payload**: inspect should report applied state but explain that operation detail is unavailable without a matching claim record.
- **Coverage drift from new command code**: add focused command tests and run `npm run test:coverage`.
- **Accidental token requirement**: avoid `parseEnv()` in audit CLI wiring and test `parseAuditEnv()` without `YNAB_ACCESS_TOKEN`.

## Premortem

- A user runs `audit status` after a crash and sees nothing because the default audit path is wrong. Mitigation: support `--audit-log <path>` and document the env/default in README.
- A user sees an applied operation in the log and assumes YNAB is correct. Mitigation: wording should say audit state only reflects local claim/apply records; it is not current YNAB truth.
- A partial apply has one child update already applied, but the CLI cannot know which. Mitigation: output the planned child updates and recovery warning, not a recommended automatic action.
- A future implementation widens the job audit interface and forces unrelated fakes to grow. Mitigation: keep scan/read surface separate from `BudgetOperationAuditLog`.
