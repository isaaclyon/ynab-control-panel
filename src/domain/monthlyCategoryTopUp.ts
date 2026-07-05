import type { CategoryMonthSnapshot } from "./categoryMonth.js";
import type { BudgetMonth } from "./month.js";
import { formatMilliunits, milliunits, type Milliunits } from "./money.js";
import type { PlannedBudgetOperation } from "./budgetOperation.js";

export type MonthlyCategoryTopUpRule = {
  readonly id: string;
  readonly type: "monthly-category-top-up";
  readonly description?: string | undefined;
  readonly enabled: boolean;
  readonly budgetId: string;
  readonly categoryId: string;
  readonly monthlyAmount: Milliunits;
  readonly targetBalance: Milliunits;
};

export type { CategoryMonthSnapshot } from "./categoryMonth.js";

export type MonthlyCategoryTopUpPlan = {
  readonly ruleId: string;
  readonly budgetId: string;
  readonly categoryId: string;
  readonly month: BudgetMonth;
  readonly assignmentAmount: Milliunits;
  readonly budgetedBefore: Milliunits;
  readonly budgetedAfter: Milliunits;
  readonly balanceBefore: Milliunits;
  readonly targetBalance: Milliunits;
  readonly reason: "target-already-met" | "top-up-needed";
};

export function planMonthlyCategoryTopUp(input: {
  readonly rule: MonthlyCategoryTopUpRule;
  readonly month: BudgetMonth;
  readonly snapshot: CategoryMonthSnapshot;
}): MonthlyCategoryTopUpPlan {
  const neededToReachTarget = Math.max(input.rule.targetBalance - input.snapshot.balance, 0);
  const assignmentAmount = milliunits(Math.min(input.rule.monthlyAmount, neededToReachTarget));
  const budgetedAfter = milliunits(input.snapshot.budgeted + assignmentAmount);

  return {
    ruleId: input.rule.id,
    budgetId: input.rule.budgetId,
    categoryId: input.rule.categoryId,
    month: input.month,
    assignmentAmount,
    budgetedBefore: input.snapshot.budgeted,
    budgetedAfter,
    balanceBefore: input.snapshot.balance,
    targetBalance: input.rule.targetBalance,
    reason: assignmentAmount === 0 ? "target-already-met" : "top-up-needed",
  };
}

export function planMonthlyCategoryTopUpOperation(input: {
  readonly rule: MonthlyCategoryTopUpRule;
  readonly month: BudgetMonth;
  readonly snapshot: CategoryMonthSnapshot;
}): PlannedBudgetOperation {
  const plan = planMonthlyCategoryTopUp(input);

  return {
    ruleId: plan.ruleId,
    ruleType: input.rule.type,
    ...(input.rule.description ? { description: input.rule.description } : {}),
    budgetId: plan.budgetId,
    month: plan.month,
    summary: `assign ${formatMilliunits(plan.assignmentAmount)} to ${plan.categoryId} toward ${formatMilliunits(plan.targetBalance)} target`,
    reason: plan.reason,
    updates: [
      {
        categoryId: plan.categoryId,
        budgetedBefore: plan.budgetedBefore,
        budgetedAfter: plan.budgetedAfter,
        delta: plan.assignmentAmount,
        role: "primary",
      },
    ],
  };
}
