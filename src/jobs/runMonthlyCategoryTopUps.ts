import type { BudgetMonth } from "../domain/month.js";
import { formatMilliunits } from "../domain/money.js";
import { planMonthlyCategoryTopUp, type MonthlyCategoryTopUpPlan } from "../domain/monthlyCategoryTopUp.js";
import type { BudgetClient } from "../ynab/budgetClient.js";
import type { RulesConfig } from "../config/rules.js";
import type { TopUpAuditLog } from "../audit/auditLog.js";

export type TopUpRunResult = {
  readonly plan: MonthlyCategoryTopUpPlan;
  readonly status: "dry-run" | "applied" | "skipped-already-claimed" | "skipped-no-op";
};

export async function runMonthlyCategoryTopUps(input: {
  readonly config: RulesConfig;
  readonly month: BudgetMonth;
  readonly dryRun: boolean;
  readonly budgetClient: BudgetClient;
  readonly auditLog: TopUpAuditLog;
  readonly now?: Date;
}): Promise<readonly TopUpRunResult[]> {
  const results: TopUpRunResult[] = [];

  for (const rule of input.config.rules) {
    const snapshot = await input.budgetClient.getCategoryMonth({
      budgetId: rule.budgetId,
      month: input.month,
      categoryId: rule.categoryId,
    });
    const plan = planMonthlyCategoryTopUp({ rule, month: input.month, snapshot });

    if (plan.assignmentAmount === 0) {
      results.push({ plan, status: "skipped-no-op" });
      continue;
    }

    const result = await input.auditLog.runExclusive(rule.id, input.month, async (): Promise<TopUpRunResult> => {
      if (await input.auditLog.hasClaimedOrApplied(rule.id, input.month)) {
        return { plan, status: "skipped-already-claimed" };
      }

      if (input.dryRun) {
        return { plan, status: "dry-run" };
      }

      const appliedAt = (input.now ?? new Date()).toISOString();
      await input.auditLog.append({
        kind: "monthly-category-top-up-claimed",
        ruleId: rule.id,
        budgetId: rule.budgetId,
        categoryId: rule.categoryId,
        month: input.month,
        assignmentAmount: plan.assignmentAmount,
        budgetedAfter: plan.budgetedAfter,
        claimedAt: appliedAt,
      });
      await input.budgetClient.updateCategoryBudgeted({
        budgetId: rule.budgetId,
        month: input.month,
        categoryId: rule.categoryId,
        budgeted: plan.budgetedAfter,
      });
      await input.auditLog.append({
        kind: "monthly-category-top-up-applied",
        ruleId: rule.id,
        budgetId: rule.budgetId,
        categoryId: rule.categoryId,
        month: input.month,
        assignmentAmount: plan.assignmentAmount,
        budgetedAfter: plan.budgetedAfter,
        appliedAt,
      });

      return { plan, status: "applied" };
    });

    results.push(result);
  }

  return results;
}

export function formatTopUpRunResults(results: readonly TopUpRunResult[]): string {
  return results
    .map(({ plan, status }) => {
      return [
        `${status}: ${plan.ruleId}`,
        `  category: ${plan.categoryId}`,
        `  month: ${plan.month}`,
        `  balance: ${formatMilliunits(plan.balanceBefore)} / target ${formatMilliunits(plan.targetBalance)}`,
        `  assignment: ${formatMilliunits(plan.assignmentAmount)}`,
        `  budgeted: ${formatMilliunits(plan.budgetedBefore)} -> ${formatMilliunits(plan.budgetedAfter)}`,
      ].join("\n");
    })
    .join("\n\n");
}
