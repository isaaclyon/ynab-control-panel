import type { BudgetMonth } from "./month.js";
import type { Milliunits } from "./money.js";
import type { BudgetRule } from "./budgetRule.js";

export type CategoryBudgetUpdateRole = "primary" | "source" | "destination";

export type CategoryBudgetUpdate = {
  readonly categoryId: string;
  readonly budgetedBefore: Milliunits;
  readonly budgetedAfter: Milliunits;
  readonly delta: Milliunits;
  readonly role?: CategoryBudgetUpdateRole;
};

export type PlannedBudgetOperation = {
  readonly ruleId: string;
  readonly ruleType: BudgetRule["type"];
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly summary: string;
  readonly updates: readonly CategoryBudgetUpdate[];
  readonly reason: string;
};

export function hasNonZeroBudgetUpdate(operation: PlannedBudgetOperation): boolean {
  return operation.updates.some((update) => update.delta !== 0);
}
