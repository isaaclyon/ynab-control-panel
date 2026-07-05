import type { BudgetMonth } from "./month.js";
import { milliunits, type Milliunits } from "./money.js";

export type MonthlyCategoryTopUpRule = {
  readonly id: string;
  readonly type: "monthly-category-top-up";
  readonly budgetId: string;
  readonly categoryId: string;
  readonly monthlyAmount: Milliunits;
  readonly targetBalance: Milliunits;
};

export type CategoryMonthSnapshot = {
  readonly budgeted: Milliunits;
  readonly activity: Milliunits;
  readonly balance: Milliunits;
};

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
