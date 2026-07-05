import type { CategoryMonthSnapshot } from "./categoryMonth.js";
import type { BudgetMonth } from "./month.js";
import { formatMilliunits, milliunits, type Milliunits } from "./money.js";
import type { PlannedBudgetOperation } from "./budgetOperation.js";

export type FixedAmountPolicy = {
  readonly type: "fixed";
  readonly amount: Milliunits;
};

export type PercentOfAvailableAmountPolicy = {
  readonly type: "percent-of-available";
  readonly percent: number;
  readonly max?: Milliunits | undefined;
};

export type AmountPolicy = FixedAmountPolicy | PercentOfAvailableAmountPolicy;

export type CategoryAvailableTransferRule = {
  readonly id: string;
  readonly type: "category-available-transfer";
  readonly enabled: boolean;
  readonly budgetId: string;
  readonly fromCategoryId: string;
  readonly toCategoryId: string;
  readonly amount: AmountPolicy;
  readonly leaveAvailable: Milliunits;
};

export function planCategoryAvailableTransfer(input: {
  readonly rule: CategoryAvailableTransferRule;
  readonly month: BudgetMonth;
  readonly fromSnapshot: CategoryMonthSnapshot;
  readonly toSnapshot: CategoryMonthSnapshot;
}): PlannedBudgetOperation {
  const movableAvailable = milliunits(Math.max(input.fromSnapshot.balance - input.rule.leaveAvailable, 0));
  const policyAmount = calculatePolicyAmount(input.rule.amount, movableAvailable);
  const transferAmount = milliunits(Math.min(movableAvailable, policyAmount));
  const sourceBudgetedAfter = milliunits(input.fromSnapshot.budgeted - transferAmount);
  const destinationBudgetedAfter = milliunits(input.toSnapshot.budgeted + transferAmount);

  return {
    ruleId: input.rule.id,
    ruleType: input.rule.type,
    budgetId: input.rule.budgetId,
    month: input.month,
    summary: `move ${formatMilliunits(transferAmount)} from ${input.rule.fromCategoryId} to ${input.rule.toCategoryId}`,
    reason: transferAmount === 0 ? "no-movable-available" : "transfer-needed",
    updates: [
      {
        categoryId: input.rule.fromCategoryId,
        budgetedBefore: input.fromSnapshot.budgeted,
        budgetedAfter: sourceBudgetedAfter,
        delta: milliunits(-transferAmount),
        role: "source",
      },
      {
        categoryId: input.rule.toCategoryId,
        budgetedBefore: input.toSnapshot.budgeted,
        budgetedAfter: destinationBudgetedAfter,
        delta: transferAmount,
        role: "destination",
      },
    ],
  };
}

function calculatePolicyAmount(policy: AmountPolicy, movableAvailable: Milliunits): Milliunits {
  switch (policy.type) {
    case "fixed":
      return policy.amount;
    case "percent-of-available": {
      const percentAmount = milliunits(Math.floor((movableAvailable * policy.percent) / 100));
      return policy.max === undefined ? percentAmount : milliunits(Math.min(percentAmount, policy.max));
    }
  }
}
