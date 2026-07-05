import { describe, expect, it } from "vitest";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import { planMonthlyCategoryTopUp, type MonthlyCategoryTopUpRule } from "../../src/domain/monthlyCategoryTopUp.js";

const rule: MonthlyCategoryTopUpRule = {
  id: "rule-1",
  type: "monthly-category-top-up",
  enabled: true,
  budgetId: "budget-1",
  categoryId: "category-1",
  monthlyAmount: milliunits(50_000),
  targetBalance: milliunits(200_000),
};

describe("monthly category top-up planning", () => {
  it("assigns the monthly amount when the target gap is larger than the cap", () => {
    const plan = planMonthlyCategoryTopUp({
      rule,
      month: parseBudgetMonth("2026-07"),
      snapshot: {
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      },
    });

    expect(plan.assignmentAmount).toBe(50_000);
    expect(plan.budgetedAfter).toBe(75_000);
    expect(plan.reason).toBe("top-up-needed");
  });

  it("assigns only the remaining target gap when it is below the monthly cap", () => {
    const plan = planMonthlyCategoryTopUp({
      rule,
      month: parseBudgetMonth("2026-07"),
      snapshot: {
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(180_000),
      },
    });

    expect(plan.assignmentAmount).toBe(20_000);
    expect(plan.budgetedAfter).toBe(45_000);
  });

  it("does nothing when the category is already at or above target", () => {
    const plan = planMonthlyCategoryTopUp({
      rule,
      month: parseBudgetMonth("2026-07"),
      snapshot: {
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(250_000),
      },
    });

    expect(plan.assignmentAmount).toBe(0);
    expect(plan.budgetedAfter).toBe(25_000);
    expect(plan.reason).toBe("target-already-met");
  });
});
