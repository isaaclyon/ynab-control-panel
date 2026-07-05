import type { CategoryBudgetUpdate } from "./budgetOperation.js";
import type { CategoryMonthSnapshot } from "./categoryMonth.js";
import type { BudgetMonth } from "./month.js";
import { formatMilliunits, milliunits, type Milliunits } from "./money.js";

export type CarryoverCategorySnapshot = CategoryMonthSnapshot & {
  readonly categoryId: string;
  readonly categoryName?: string | undefined;
};

export type CarryoverPlanStatus = "planned" | "partial" | "uncovered";

export type CarryoverPlanOperation = {
  readonly kind: "closing-month-cover" | "reversal-month-restore";
  readonly month: BudgetMonth;
  readonly summary: string;
  readonly updates: readonly CategoryBudgetUpdate[];
};

export type CarryoverPlanItem = {
  readonly categoryId: string;
  readonly categoryName?: string | undefined;
  readonly negativeBalance: Milliunits;
  readonly carryoverAmount: Milliunits;
  readonly uncoveredAmount: Milliunits;
  readonly status: CarryoverPlanStatus;
  readonly allocations: readonly {
    readonly sourceCategoryId: string;
    readonly sourceCategoryName?: string | undefined;
    readonly amount: Milliunits;
  }[];
  readonly operations: readonly CarryoverPlanOperation[];
};

export type CarryoverPlan = {
  readonly budgetId: string;
  readonly closingMonth: BudgetMonth;
  readonly reversalMonth: BudgetMonth;
  readonly sourcePriority: readonly string[];
  readonly items: readonly CarryoverPlanItem[];
  readonly totalNegativeBalance: Milliunits;
  readonly totalCarryoverAmount: Milliunits;
  readonly totalUncoveredAmount: Milliunits;
};

export function planCarryover(input: {
  readonly budgetId: string;
  readonly closingMonth: BudgetMonth;
  readonly reversalMonth: BudgetMonth;
  readonly negativeCategories: readonly CarryoverCategorySnapshot[];
  readonly sources: readonly CarryoverCategorySnapshot[];
  readonly reversalSnapshots: readonly CarryoverCategorySnapshot[];
  readonly sourcePriority: readonly string[];
}): CarryoverPlan {
  const sourceStates = input.sourcePriority.map((categoryId) => {
    const closingSnapshot = requireSnapshot(input.sources, categoryId, "closing source");
    const reversalSnapshot = requireSnapshot(input.reversalSnapshots, categoryId, "reversal source");

    return {
      categoryId,
      categoryName: closingSnapshot.categoryName ?? reversalSnapshot.categoryName,
      remainingAvailable: milliunits(Math.max(closingSnapshot.balance, 0)),
      closingBudgetedCursor: closingSnapshot.budgeted,
      reversalBudgetedCursor: reversalSnapshot.budgeted,
    };
  });
  const items: CarryoverPlanItem[] = [];

  for (const negativeCategory of input.negativeCategories.filter((category) => category.balance < 0)) {
    const needed = milliunits(-negativeCategory.balance);
    const reversalCategory = requireSnapshot(input.reversalSnapshots, negativeCategory.categoryId, "reversal category");
    const allocations: {
      sourceCategoryId: string;
      sourceCategoryName?: string | undefined;
      amount: Milliunits;
    }[] = [];
    const closingSourceUpdates: CategoryBudgetUpdate[] = [];
    const reversalSourceUpdates: CategoryBudgetUpdate[] = [];
    let remainingNeed = needed;

    for (const sourceState of sourceStates) {
      if (remainingNeed === 0) {
        break;
      }

      const amount = milliunits(Math.min(sourceState.remainingAvailable, remainingNeed));
      if (amount === 0) {
        continue;
      }

      const closingBudgetedBefore = sourceState.closingBudgetedCursor;
      const closingBudgetedAfter = milliunits(closingBudgetedBefore - amount);
      const reversalBudgetedBefore = sourceState.reversalBudgetedCursor;
      const reversalBudgetedAfter = milliunits(reversalBudgetedBefore + amount);

      allocations.push({
        sourceCategoryId: sourceState.categoryId,
        ...(sourceState.categoryName ? { sourceCategoryName: sourceState.categoryName } : {}),
        amount,
      });
      closingSourceUpdates.push({
        categoryId: sourceState.categoryId,
        ...(sourceState.categoryName ? { categoryName: sourceState.categoryName } : {}),
        budgetedBefore: closingBudgetedBefore,
        budgetedAfter: closingBudgetedAfter,
        delta: milliunits(-amount),
        role: "source",
      });
      reversalSourceUpdates.push({
        categoryId: sourceState.categoryId,
        ...(sourceState.categoryName ? { categoryName: sourceState.categoryName } : {}),
        budgetedBefore: reversalBudgetedBefore,
        budgetedAfter: reversalBudgetedAfter,
        delta: amount,
        role: "destination",
      });

      sourceState.remainingAvailable = milliunits(sourceState.remainingAvailable - amount);
      sourceState.closingBudgetedCursor = closingBudgetedAfter;
      sourceState.reversalBudgetedCursor = reversalBudgetedAfter;
      remainingNeed = milliunits(remainingNeed - amount);
    }

    const carryoverAmount = milliunits(needed - remainingNeed);
    const operations = buildOperations({
      closingMonth: input.closingMonth,
      reversalMonth: input.reversalMonth,
      category: negativeCategory,
      reversalCategory,
      carryoverAmount,
      closingSourceUpdates,
      reversalSourceUpdates,
    });

    items.push({
      categoryId: negativeCategory.categoryId,
      ...(negativeCategory.categoryName ? { categoryName: negativeCategory.categoryName } : {}),
      negativeBalance: needed,
      carryoverAmount,
      uncoveredAmount: remainingNeed,
      status: carryoverStatus({ carryoverAmount, uncoveredAmount: remainingNeed }),
      allocations,
      operations,
    });
  }

  return {
    budgetId: input.budgetId,
    closingMonth: input.closingMonth,
    reversalMonth: input.reversalMonth,
    sourcePriority: input.sourcePriority,
    items,
    totalNegativeBalance: sum(items.map((item) => item.negativeBalance)),
    totalCarryoverAmount: sum(items.map((item) => item.carryoverAmount)),
    totalUncoveredAmount: sum(items.map((item) => item.uncoveredAmount)),
  };
}

export function formatCarryoverPlan(plan: CarryoverPlan): string {
  return [
    "carryover assistant dry-run",
    `budget: ${plan.budgetId}`,
    `closing month: ${plan.closingMonth}`,
    `reversal month: ${plan.reversalMonth}`,
    `source priority: ${plan.sourcePriority.join(", ")}`,
    `negative categories found: ${plan.items.length}`,
    `total negative balance: ${formatMilliunits(plan.totalNegativeBalance)}`,
    `planned carryover: ${formatMilliunits(plan.totalCarryoverAmount)}`,
    `uncovered negative balance: ${formatMilliunits(plan.totalUncoveredAmount)}`,
    ...plan.items.flatMap(formatCarryoverPlanItem),
  ].join("\n");
}

export function formatCarryoverPlanJson(plan: CarryoverPlan): string {
  return JSON.stringify(plan, null, 2);
}

function buildOperations(input: {
  readonly closingMonth: BudgetMonth;
  readonly reversalMonth: BudgetMonth;
  readonly category: CarryoverCategorySnapshot;
  readonly reversalCategory: CarryoverCategorySnapshot;
  readonly carryoverAmount: Milliunits;
  readonly closingSourceUpdates: readonly CategoryBudgetUpdate[];
  readonly reversalSourceUpdates: readonly CategoryBudgetUpdate[];
}): readonly CarryoverPlanOperation[] {
  if (input.carryoverAmount === 0) {
    return [];
  }

  return [
    {
      kind: "closing-month-cover",
      month: input.closingMonth,
      summary: `cover ${formatMilliunits(input.carryoverAmount)} of ${formatCategoryReference(input.category)} negative balance`,
      updates: [
        ...input.closingSourceUpdates,
        {
          categoryId: input.category.categoryId,
          ...(input.category.categoryName ? { categoryName: input.category.categoryName } : {}),
          budgetedBefore: input.category.budgeted,
          budgetedAfter: milliunits(input.category.budgeted + input.carryoverAmount),
          delta: input.carryoverAmount,
          role: "destination",
        },
      ],
    },
    {
      kind: "reversal-month-restore",
      month: input.reversalMonth,
      summary: `restore ${formatMilliunits(input.carryoverAmount)} from ${formatCategoryReference(input.category)} to original sources`,
      updates: [
        {
          categoryId: input.category.categoryId,
          ...(input.category.categoryName ? { categoryName: input.category.categoryName } : {}),
          budgetedBefore: input.reversalCategory.budgeted,
          budgetedAfter: milliunits(input.reversalCategory.budgeted - input.carryoverAmount),
          delta: milliunits(-input.carryoverAmount),
          role: "source",
        },
        ...input.reversalSourceUpdates,
      ],
    },
  ];
}

function formatCarryoverPlanItem(item: CarryoverPlanItem): string[] {
  return [
    "",
    `${item.status}: ${formatCategoryReference(item)} negative ${formatMilliunits(item.negativeBalance)}, carry over ${formatMilliunits(item.carryoverAmount)}, uncovered ${formatMilliunits(item.uncoveredAmount)}`,
    ...item.operations.flatMap((operation) => [
      `  ${operation.month} ${operation.kind}: ${operation.summary}`,
      ...operation.updates.map(
        (update) =>
          `    ${formatUpdateCategoryReference(update)} budgeted: ${formatMilliunits(update.budgetedBefore)} -> ${formatMilliunits(update.budgetedAfter)} (${formatDelta(update.delta)})`,
      ),
    ]),
  ];
}

function carryoverStatus(input: {
  readonly carryoverAmount: Milliunits;
  readonly uncoveredAmount: Milliunits;
}): CarryoverPlanStatus {
  if (input.carryoverAmount === 0) {
    return "uncovered";
  }

  return input.uncoveredAmount === 0 ? "planned" : "partial";
}

function requireSnapshot(
  snapshots: readonly CarryoverCategorySnapshot[],
  categoryId: string,
  label: string,
): CarryoverCategorySnapshot {
  const snapshot = snapshots.find((candidate) => candidate.categoryId === categoryId);
  if (!snapshot) {
    throw new Error(`Missing ${label} snapshot for category ${categoryId}`);
  }

  return snapshot;
}

function sum(values: readonly Milliunits[]): Milliunits {
  return milliunits(values.reduce((total, value) => total + value, 0));
}

function formatCategoryReference(category: {
  readonly categoryId: string;
  readonly categoryName?: string | undefined;
}) {
  return category.categoryName
    ? `${category.categoryId} (${formatDisplayText(category.categoryName)})`
    : category.categoryId;
}

function formatUpdateCategoryReference(update: CategoryBudgetUpdate): string {
  return update.categoryName ? `${update.categoryId} (${formatDisplayText(update.categoryName)})` : update.categoryId;
}

function formatDisplayText(value: string): string {
  return value.replace(/[\t\n\r]+/g, " ");
}

function formatDelta(delta: Milliunits): string {
  return delta >= 0 ? `+${formatMilliunits(delta)}` : formatMilliunits(delta);
}
