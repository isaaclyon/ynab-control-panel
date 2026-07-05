import type { BudgetOperationAuditLog } from "../audit/auditLog.js";
import type { RulesConfig } from "../config/rules.js";
import { hasNonZeroBudgetUpdate, type PlannedBudgetOperation } from "../domain/budgetOperation.js";
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
  | "skipped-no-op";

export type BudgetRuleRunResult = {
  readonly operation: PlannedBudgetOperation;
  readonly status: BudgetRuleRunStatus;
};

export async function runBudgetRules(input: {
  readonly config: RulesConfig;
  readonly month: BudgetMonth;
  readonly dryRun: boolean;
  readonly budgetClient: BudgetClient;
  readonly auditLog: BudgetOperationAuditLog;
  readonly now?: Date;
}): Promise<readonly BudgetRuleRunResult[]> {
  const results: BudgetRuleRunResult[] = [];

  for (const rule of input.config.rules) {
    if (!rule.enabled) {
      continue;
    }

    const operation = await planRuleOperation({ rule, month: input.month, budgetClient: input.budgetClient });

    if (!hasNonZeroBudgetUpdate(operation)) {
      results.push({ operation, status: "skipped-no-op" });
      continue;
    }

    const result = await input.auditLog.runExclusive(rule.id, input.month, async (): Promise<BudgetRuleRunResult> => {
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
    });

    results.push(result);
  }

  return results;
}

export function formatBudgetRuleRunResults(results: readonly BudgetRuleRunResult[]): string {
  return results
    .map(({ operation, status }) =>
      [
        `${status}: ${operation.ruleId} (${operation.ruleType})`,
        `  month: ${operation.month}`,
        `  ${operation.summary}`,
        ...operation.updates.map(
          (update) =>
            `  ${update.categoryId} budgeted: ${formatMilliunits(update.budgetedBefore)} -> ${formatMilliunits(update.budgetedAfter)} (${formatDelta(update.delta)})`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
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
