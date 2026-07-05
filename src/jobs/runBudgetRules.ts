import type { BudgetOperationAuditLog } from "../audit/auditLog.js";
import type { RulesConfig } from "../config/rules.js";
import {
  hasNonZeroBudgetUpdate,
  type CategoryBudgetUpdate,
  type PlannedBudgetOperation,
} from "../domain/budgetOperation.js";
import type { BudgetRule } from "../domain/budgetRule.js";
import { planCategoryAvailableTransfer } from "../domain/categoryAvailableTransfer.js";
import type { BudgetMonth } from "../domain/month.js";
import { formatMilliunits, type Milliunits } from "../domain/money.js";
import { planMonthlyCategoryTopUpOperation } from "../domain/monthlyCategoryTopUp.js";
import type { BudgetClient } from "../ynab/budgetClient.js";

export type BudgetRuleRunStatus =
  | "dry-run"
  | "applied"
  | "skipped-already-applied"
  | "skipped-pending-recovery"
  | "skipped-no-op"
  | "skipped-disabled";

type BudgetRuleOperationRunStatus = Exclude<BudgetRuleRunStatus, "skipped-disabled">;

export type BudgetRuleOperationRunResult = {
  readonly operation: PlannedBudgetOperation;
  readonly status: BudgetRuleOperationRunStatus;
};

export type DisabledBudgetRuleRunResult = {
  readonly status: "skipped-disabled";
  readonly ruleId: string;
  readonly ruleType: BudgetRule["type"];
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly reason: "rule-disabled";
};

export type BudgetRuleRunResult = BudgetRuleOperationRunResult | DisabledBudgetRuleRunResult;

export type CategoryNameLookup = (input: {
  readonly budgetId: string;
  readonly categoryId: string;
}) => string | undefined;

export type BudgetRuleRunSummary = {
  readonly totalRulesConsidered: number;
  readonly plannedOperations: number;
  readonly appliedOperations: number;
  readonly skippedAlreadyAppliedOperations: number;
  readonly noOpOperations: number;
  readonly pendingRecoveryOperations: number;
  readonly skippedDisabledRules: number;
  readonly totalMovedOrBudgeted: Milliunits;
};

export async function runBudgetRules(input: {
  readonly config: RulesConfig;
  readonly month: BudgetMonth;
  readonly dryRun: boolean;
  readonly budgetClient: BudgetClient;
  readonly auditLog: BudgetOperationAuditLog;
  readonly categoryNameLookup?: CategoryNameLookup;
  readonly now?: Date;
}): Promise<readonly BudgetRuleRunResult[]> {
  const results: BudgetRuleRunResult[] = [];

  for (const rule of input.config.rules) {
    if (!rule.enabled) {
      results.push({
        status: "skipped-disabled",
        ruleId: rule.id,
        ruleType: rule.type,
        budgetId: rule.budgetId,
        month: input.month,
        reason: "rule-disabled",
      });
      continue;
    }

    const operation = enrichOperationCategoryNames(
      await planRuleOperation({ rule, month: input.month, budgetClient: input.budgetClient }),
      input.categoryNameLookup,
    );

    if (!hasNonZeroBudgetUpdate(operation)) {
      results.push({ operation, status: "skipped-no-op" });
      continue;
    }

    const result = await input.auditLog.runExclusive(
      rule.id,
      input.month,
      async (): Promise<BudgetRuleOperationRunResult> => {
        const auditState = await input.auditLog.getOperationState({
          ruleId: rule.id,
          budgetId: rule.budgetId,
          month: input.month,
        });

        if (auditState === "applied") {
          return { operation, status: "skipped-already-applied" };
        }

        if (auditState === "claimed") {
          return { operation, status: "skipped-pending-recovery" };
        }

        if (input.dryRun) {
          return { operation, status: "dry-run" };
        }

        const appliedAt = (input.now ?? new Date()).toISOString();
        await input.auditLog.append({
          kind: "budget-operation-claimed",
          ruleId: operation.ruleId,
          ruleType: operation.ruleType,
          budgetId: operation.budgetId,
          month: operation.month,
          operation,
          claimedAt: appliedAt,
        });

        for (const update of operation.updates) {
          if (update.delta === 0) {
            continue;
          }

          await input.budgetClient.updateCategoryBudgeted({
            budgetId: operation.budgetId,
            month: operation.month,
            categoryId: update.categoryId,
            budgeted: update.budgetedAfter,
          });
        }

        await input.auditLog.append({
          kind: "budget-operation-applied",
          ruleId: operation.ruleId,
          ruleType: operation.ruleType,
          budgetId: operation.budgetId,
          month: operation.month,
          appliedAt,
        });

        return { operation, status: "applied" };
      },
    );

    results.push(result);
  }

  return results;
}

export function summarizeBudgetRuleRun(input: {
  readonly results: readonly BudgetRuleRunResult[];
  readonly totalRulesConsidered?: number;
}): BudgetRuleRunSummary {
  const plannedOrAppliedResults = input.results.filter(
    (result): result is BudgetRuleOperationRunResult => result.status === "dry-run" || result.status === "applied",
  );
  const totalRulesConsidered = input.totalRulesConsidered ?? input.results.length;

  return {
    totalRulesConsidered,
    plannedOperations: countStatus(input.results, "dry-run"),
    appliedOperations: countStatus(input.results, "applied"),
    skippedAlreadyAppliedOperations: countStatus(input.results, "skipped-already-applied"),
    noOpOperations: countStatus(input.results, "skipped-no-op"),
    pendingRecoveryOperations: countStatus(input.results, "skipped-pending-recovery"),
    skippedDisabledRules: countStatus(input.results, "skipped-disabled") + totalRulesConsidered - input.results.length,
    totalMovedOrBudgeted: sumMovedOrBudgeted(plannedOrAppliedResults.map((result) => result.operation)),
  };
}

export function formatBudgetRuleRunResults(
  results: readonly BudgetRuleRunResult[],
  options: { readonly totalRulesConsidered?: number } = {},
): string {
  const details = results.map((result) => formatBudgetRuleRunResult(result)).join("\n\n");
  const summary = formatBudgetRuleRunSummary(summarizeBudgetRuleRun({ results, ...options }));

  return details ? `${details}\n\n${summary}` : summary;
}

function formatBudgetRuleRunResult(result: BudgetRuleRunResult): string {
  if (result.status === "skipped-disabled") {
    return [
      `${result.status}: ${result.ruleId} (${result.ruleType})`,
      `  month: ${result.month}`,
      `  reason: ${formatRunReason(result.reason)}`,
    ].join("\n");
  }

  return [
    `${result.status}: ${result.operation.ruleId} (${result.operation.ruleType})`,
    `  month: ${result.operation.month}`,
    `  ${result.operation.summary}`,
    `  reason: ${formatResultReason(result)}`,
    ...result.operation.updates.map(
      (update) =>
        `  ${formatCategoryReference(update)} budgeted: ${formatMilliunits(update.budgetedBefore)} -> ${formatMilliunits(update.budgetedAfter)} (${formatDelta(update.delta)})`,
    ),
  ].join("\n");
}

function formatResultReason(result: BudgetRuleOperationRunResult): string {
  switch (result.status) {
    case "skipped-already-applied":
      return "skipped because the audit log already records this operation as applied for the budget/rule/month";
    case "skipped-pending-recovery":
      return "skipped because the audit log has a claim without an applied record; inspect pending recovery before retrying";
    default:
      return formatRunReason(result.operation.reason);
  }
}

function enrichOperationCategoryNames(
  operation: PlannedBudgetOperation,
  lookup: CategoryNameLookup | undefined,
): PlannedBudgetOperation {
  if (!lookup) {
    return operation;
  }

  const updates = operation.updates.map((update) => {
    const categoryName = lookup({ budgetId: operation.budgetId, categoryId: update.categoryId });
    return categoryName ? { ...update, categoryName } : update;
  });

  return {
    ...operation,
    summary: enrichCategoryReferences(operation.summary, updates),
    updates,
  };
}

function enrichCategoryReferences(summary: string, updates: readonly CategoryBudgetUpdate[]): string {
  const enrichedUpdates = [...updates]
    .filter((update) => update.categoryName)
    .sort((left, right) => right.categoryId.length - left.categoryId.length);

  if (enrichedUpdates.length === 0) {
    return summary;
  }

  const categoryReferences = new Map(
    enrichedUpdates.map((update) => [update.categoryId, formatCategoryReference(update)] as const),
  );
  const categoryIdPattern = new RegExp(enrichedUpdates.map((update) => escapeRegex(update.categoryId)).join("|"), "g");

  return summary.replace(categoryIdPattern, (categoryId) => categoryReferences.get(categoryId) ?? categoryId);
}

function formatCategoryReference(update: CategoryBudgetUpdate): string {
  return update.categoryName ? `${update.categoryId} (${formatCategoryName(update.categoryName)})` : update.categoryId;
}

function formatCategoryName(name: string): string {
  return name.replace(/[\t\n\r]+/g, " ");
}

function formatRunReason(reason: string): string {
  switch (reason) {
    case "top-up-needed":
      return "top-up needed to move the category toward its target balance";
    case "target-already-met":
      return "no-op because the category available balance is already at or above the target";
    case "transfer-needed":
      return "transfer needed from the source category to the destination category";
    case "source-available-at-or-below-leave-available":
    case "no-movable-available":
      return "no-op because source available balance is at or below the configured leaveAvailable floor";
    case "amount-policy-rounded-to-zero":
      return "no-op because the amount policy calculated $0.00 to move";
    case "rule-disabled":
      return "skipped because the rule is disabled in config";
    default:
      return reason;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBudgetRuleRunSummary(summary: BudgetRuleRunSummary): string {
  return [
    "Summary:",
    `  rules considered: ${summary.totalRulesConsidered}`,
    `  planned operations: ${summary.plannedOperations}`,
    `  applied operations: ${summary.appliedOperations}`,
    `  skipped/already-applied operations: ${summary.skippedAlreadyAppliedOperations}`,
    `  no-op operations: ${summary.noOpOperations}`,
    `  pending-recovery operations: ${summary.pendingRecoveryOperations}`,
    `  skipped disabled rules: ${summary.skippedDisabledRules}`,
    `  total moved or budgeted: ${formatMilliunits(summary.totalMovedOrBudgeted)}`,
  ].join("\n");
}

function countStatus(results: readonly BudgetRuleRunResult[], status: BudgetRuleRunStatus): number {
  return results.filter((result) => result.status === status).length;
}

function sumMovedOrBudgeted(operations: readonly PlannedBudgetOperation[]): Milliunits {
  return operations.reduce<Milliunits>((total, operation) => {
    const operationAmount = operation.updates.reduce(
      (operationTotal, update) => operationTotal + Math.max(update.delta, 0),
      0,
    );
    return (total + operationAmount) as Milliunits;
  }, 0 as Milliunits);
}

async function planRuleOperation(input: {
  readonly rule: BudgetRule;
  readonly month: BudgetMonth;
  readonly budgetClient: BudgetClient;
}): Promise<PlannedBudgetOperation> {
  switch (input.rule.type) {
    case "monthly-category-top-up": {
      const snapshot = await input.budgetClient.getCategoryMonth({
        budgetId: input.rule.budgetId,
        month: input.month,
        categoryId: input.rule.categoryId,
      });
      return planMonthlyCategoryTopUpOperation({ rule: input.rule, month: input.month, snapshot });
    }
    case "category-available-transfer": {
      const [fromSnapshot, toSnapshot] = await Promise.all([
        input.budgetClient.getCategoryMonth({
          budgetId: input.rule.budgetId,
          month: input.month,
          categoryId: input.rule.fromCategoryId,
        }),
        input.budgetClient.getCategoryMonth({
          budgetId: input.rule.budgetId,
          month: input.month,
          categoryId: input.rule.toCategoryId,
        }),
      ]);
      return planCategoryAvailableTransfer({ rule: input.rule, month: input.month, fromSnapshot, toSnapshot });
    }
  }
}

function formatDelta(delta: Milliunits): string {
  if (delta > 0) {
    return `+${formatMilliunits(delta)}`;
  }

  return formatMilliunits(delta);
}
