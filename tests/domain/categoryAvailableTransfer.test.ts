import { describe, expect, it } from "vitest";
import {
  planCategoryAvailableTransfer,
  type CategoryAvailableTransferRule,
} from "../../src/domain/categoryAvailableTransfer.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";

const baseRule: CategoryAvailableTransferRule = {
  id: "transfer-1",
  type: "category-available-transfer",
  enabled: true,
  budgetId: "budget-1",
  fromCategoryId: "source",
  toCategoryId: "destination",
  amount: { type: "fixed", amount: milliunits(50_000) },
  leaveAvailable: milliunits(25_000),
};

describe("category available transfer planning", () => {
  it("moves a fixed amount without dropping source available below the leave floor", () => {
    const operation = planCategoryAvailableTransfer({
      rule: baseRule,
      month: parseBudgetMonth("2026-07"),
      fromSnapshot: { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(200_000) },
      toSnapshot: { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(10_000) },
    });

    expect(operation.reason).toBe("transfer-needed");
    expect(operation.updates).toMatchObject([
      { categoryId: "source", budgetedBefore: 100_000, budgetedAfter: 50_000, delta: -50_000, role: "source" },
      {
        categoryId: "destination",
        budgetedBefore: 10_000,
        budgetedAfter: 60_000,
        delta: 50_000,
        role: "destination",
      },
    ]);
  });

  it("caps percent transfers by max and rounds down to whole milliunits", () => {
    const operation = planCategoryAvailableTransfer({
      rule: {
        ...baseRule,
        amount: { type: "percent-of-available", percent: 33.333, max: milliunits(40_000) },
        leaveAvailable: milliunits(0),
      },
      month: parseBudgetMonth("2026-07"),
      fromSnapshot: { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(123_457) },
      toSnapshot: { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) },
    });

    expect(operation.updates[0]?.delta).toBe(-40_000);
    expect(operation.updates[1]?.delta).toBe(40_000);
  });

  it("allows moving carried-over available even when source budgeted becomes negative", () => {
    const operation = planCategoryAvailableTransfer({
      rule: { ...baseRule, amount: { type: "fixed", amount: milliunits(75_000) }, leaveAvailable: milliunits(25_000) },
      month: parseBudgetMonth("2026-07"),
      fromSnapshot: { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(100_000) },
      toSnapshot: { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) },
    });

    expect(operation.updates[0]?.budgetedAfter).toBe(-65_000);
    expect(operation.updates[1]?.budgetedAfter).toBe(75_000);
  });

  it("returns a no-op when no available money can move", () => {
    const operation = planCategoryAvailableTransfer({
      rule: baseRule,
      month: parseBudgetMonth("2026-07"),
      fromSnapshot: { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(25_000) },
      toSnapshot: { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) },
    });

    expect(operation.reason).toBe("source-available-at-or-below-leave-available");
    expect(operation.updates.every((update) => update.delta === 0)).toBe(true);
  });

  it("explains when a percent policy rounds down to zero", () => {
    const operation = planCategoryAvailableTransfer({
      rule: { ...baseRule, amount: { type: "percent-of-available", percent: 1 }, leaveAvailable: milliunits(0) },
      month: parseBudgetMonth("2026-07"),
      fromSnapshot: { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(50) },
      toSnapshot: { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) },
    });

    expect(operation.reason).toBe("amount-policy-rounded-to-zero");
    expect(operation.updates.every((update) => update.delta === 0)).toBe(true);
  });

  it("copies the rule description to the planned operation", () => {
    const operation = planCategoryAvailableTransfer({
      rule: { ...baseRule, description: "Sweep dining leftovers" },
      month: parseBudgetMonth("2026-07"),
      fromSnapshot: { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(200_000) },
      toSnapshot: { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(10_000) },
    });

    expect(operation.description).toBe("Sweep dining leftovers");
  });
});
