import { describe, expect, it } from "vitest";
import { formatCarryoverPlan, planCarryover, type CarryoverCategorySnapshot } from "../../src/domain/carryover.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";

describe("carryover planning", () => {
  it("covers negative categories from source priority and mirrors the reversal in the next month", () => {
    const plan = planCarryover({
      budgetId: "budget-1",
      closingMonth: parseBudgetMonth("2026-06"),
      reversalMonth: parseBudgetMonth("2026-07"),
      sourcePriority: ["source-1", "source-2"],
      negativeCategories: [snapshot("negative-1", -75_000, -20_000, "Dining")],
      sources: [snapshot("source-1", 50_000, 50_000, "Vacation"), snapshot("source-2", 100_000, 100_000, "Buffer")],
      reversalSnapshots: [
        snapshot("source-1", 10_000, 10_000, "Vacation"),
        snapshot("source-2", 20_000, 20_000, "Buffer"),
        snapshot("negative-1", 0, 0, "Dining"),
      ],
    });

    expect(plan.totalNegativeBalance).toBe(75_000);
    expect(plan.totalCarryoverAmount).toBe(75_000);
    expect(plan.totalUncoveredAmount).toBe(0);
    expect(plan.items[0]).toMatchObject({
      categoryId: "negative-1",
      status: "planned",
      allocations: [
        { sourceCategoryId: "source-1", amount: 50_000 },
        { sourceCategoryId: "source-2", amount: 25_000 },
      ],
    });
    expect(plan.items[0]?.operations).toEqual([
      {
        kind: "closing-month-cover",
        month: "2026-06",
        summary: "cover $75.00 of negative-1 (Dining) negative balance",
        updates: [
          {
            categoryId: "source-1",
            categoryName: "Vacation",
            budgetedBefore: 50_000,
            budgetedAfter: 0,
            delta: -50_000,
            role: "source",
          },
          {
            categoryId: "source-2",
            categoryName: "Buffer",
            budgetedBefore: 100_000,
            budgetedAfter: 75_000,
            delta: -25_000,
            role: "source",
          },
          {
            categoryId: "negative-1",
            categoryName: "Dining",
            budgetedBefore: -20_000,
            budgetedAfter: 55_000,
            delta: 75_000,
            role: "destination",
          },
        ],
      },
      {
        kind: "reversal-month-restore",
        month: "2026-07",
        summary: "restore $75.00 from negative-1 (Dining) to original sources",
        updates: [
          {
            categoryId: "negative-1",
            categoryName: "Dining",
            budgetedBefore: 0,
            budgetedAfter: -75_000,
            delta: -75_000,
            role: "source",
          },
          {
            categoryId: "source-1",
            categoryName: "Vacation",
            budgetedBefore: 10_000,
            budgetedAfter: 60_000,
            delta: 50_000,
            role: "destination",
          },
          {
            categoryId: "source-2",
            categoryName: "Buffer",
            budgetedBefore: 20_000,
            budgetedAfter: 45_000,
            delta: 25_000,
            role: "destination",
          },
        ],
      },
    ]);
  });

  it("reports partial carryover when priority sources cannot cover all negative balances", () => {
    const plan = planCarryover({
      budgetId: "budget-1",
      closingMonth: parseBudgetMonth("2026-06"),
      reversalMonth: parseBudgetMonth("2026-07"),
      sourcePriority: ["source-1"],
      negativeCategories: [snapshot("negative-1", -75_000, 0)],
      sources: [snapshot("source-1", 25_000, 50_000)],
      reversalSnapshots: [snapshot("source-1", 0, 0), snapshot("negative-1", 0, 0)],
    });

    expect(plan.items[0]).toMatchObject({
      status: "partial",
      negativeBalance: 75_000,
      carryoverAmount: 25_000,
      uncoveredAmount: 50_000,
    });
    expect(formatCarryoverPlan(plan)).toContain(
      "partial: negative-1 negative $75.00, carry over $25.00, uncovered $50.00",
    );
  });

  it("carries source balances forward across multiple negative categories", () => {
    const plan = planCarryover({
      budgetId: "budget-1",
      closingMonth: parseBudgetMonth("2026-06"),
      reversalMonth: parseBudgetMonth("2026-07"),
      sourcePriority: ["source-1", "source-2"],
      negativeCategories: [snapshot("negative-1", -50_000, 0), snapshot("negative-2", -30_000, 0)],
      sources: [snapshot("source-1", 60_000, 60_000), snapshot("source-2", 50_000, 50_000)],
      reversalSnapshots: [
        snapshot("source-1", 0, 0),
        snapshot("source-2", 0, 0),
        snapshot("negative-1", 0, 0),
        snapshot("negative-2", 0, 0),
      ],
    });

    expect(plan.items.map((item) => item.allocations)).toEqual([
      [{ sourceCategoryId: "source-1", amount: 50_000 }],
      [
        { sourceCategoryId: "source-1", amount: 10_000 },
        { sourceCategoryId: "source-2", amount: 20_000 },
      ],
    ]);
    expect(plan.totalCarryoverAmount).toBe(80_000);
    expect(plan.totalUncoveredAmount).toBe(0);
  });

  it("reports uncovered categories when no source has positive available balance", () => {
    const plan = planCarryover({
      budgetId: "budget-1",
      closingMonth: parseBudgetMonth("2026-06"),
      reversalMonth: parseBudgetMonth("2026-07"),
      sourcePriority: ["source-1", "source-2"],
      negativeCategories: [snapshot("negative-1", -10_000, 0)],
      sources: [snapshot("source-1", 0, 0), snapshot("source-2", -5_000, 0)],
      reversalSnapshots: [snapshot("source-1", 0, 0), snapshot("source-2", 0, 0), snapshot("negative-1", 0, 0)],
    });

    expect(plan.items[0]).toMatchObject({
      status: "uncovered",
      carryoverAmount: 0,
      uncoveredAmount: 10_000,
      operations: [],
    });
    expect(formatCarryoverPlan(plan)).toContain("uncovered: negative-1 negative $10.00");
  });

  it("throws when a reversal category snapshot is missing", () => {
    expect(() =>
      planCarryover({
        budgetId: "budget-1",
        closingMonth: parseBudgetMonth("2026-06"),
        reversalMonth: parseBudgetMonth("2026-07"),
        sourcePriority: ["source-1"],
        negativeCategories: [snapshot("negative-1", -10_000, 0)],
        sources: [snapshot("source-1", 10_000, 10_000)],
        reversalSnapshots: [snapshot("source-1", 0, 0)],
      }),
    ).toThrow("Missing reversal category snapshot for category negative-1");
  });
});

function snapshot(
  categoryId: string,
  balance: number,
  budgeted: number,
  categoryName?: string,
): CarryoverCategorySnapshot {
  return {
    categoryId,
    ...(categoryName ? { categoryName } : {}),
    budgeted: milliunits(budgeted),
    activity: milliunits(0),
    balance: milliunits(balance),
  };
}
