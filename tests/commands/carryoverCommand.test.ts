import { describe, expect, it, vi } from "vitest";
import { carryoverPlanCommand } from "../../src/commands/carryoverCommand.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import type { BudgetClient, YnabCatalogClient } from "../../src/ynab/budgetClient.js";

describe("carryover command", () => {
  it("loads all category balances, uses source priority, and prints a dry-run plan", async () => {
    const write = vi.fn();
    const client = clientFixture({
      [key("2026-06", "negative-1")]: { budgeted: -20_000, balance: -75_000 },
      [key("2026-06", "source-1")]: { budgeted: 50_000, balance: 50_000 },
      [key("2026-06", "source-2")]: { budgeted: 100_000, balance: 100_000 },
      [key("2026-07", "negative-1")]: { budgeted: 0, balance: 0 },
      [key("2026-07", "source-1")]: { budgeted: 10_000, balance: 10_000 },
      [key("2026-07", "source-2")]: { budgeted: 20_000, balance: 20_000 },
    });

    await carryoverPlanCommand({
      env: envFixture(),
      options: { budget: "budget-1", month: "2026-06", sources: "source-1, source-2" },
      stdout: { write },
      dependencies: { createClient: () => client },
    });

    expect(client.listCategories).toHaveBeenCalledWith({ budgetId: "budget-1" });
    expect(client.updateCategoryBudgeted).not.toHaveBeenCalled();
    expect(client.getCategoryMonth).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month: "2026-06",
      categoryId: "negative-1",
    });
    expect(client.getCategoryMonth).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month: "2026-07",
      categoryId: "source-2",
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("carryover assistant dry-run"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("closing month: 2026-06"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("reversal month: 2026-07"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("planned: negative-1 (Dining) negative $75.00"));
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("source-1 (Vacation) budgeted: $50.00 -> $0.00 (-$50.00)"),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("negative-1 (Dining) budgeted: $0.00 -> -$75.00 (-$75.00)"),
    );
  });

  it("prints structured JSON when requested", async () => {
    const write = vi.fn();
    const client = clientFixture({
      [key("2026-06", "negative-1")]: { budgeted: 0, balance: -10_000 },
      [key("2026-06", "source-1")]: { budgeted: 10_000, balance: 10_000 },
      [key("2026-06", "source-2")]: { budgeted: 0, balance: 0 },
      [key("2026-07", "negative-1")]: { budgeted: 0, balance: 0 },
      [key("2026-07", "source-1")]: { budgeted: 0, balance: 0 },
    });

    await carryoverPlanCommand({
      env: envFixture(),
      options: { budget: "budget-1", month: "2026-06", sources: "source-1", json: true },
      stdout: { write },
      dependencies: { createClient: () => client },
    });

    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      totalCarryoverAmount: number;
      items: [{ status: string; categoryId: string }];
    };
    expect(output.totalCarryoverAmount).toBe(10_000);
    expect(output.items[0]).toMatchObject({ status: "planned", categoryId: "negative-1" });
  });

  it("rejects an empty source priority list", async () => {
    await expect(
      carryoverPlanCommand({
        env: envFixture(),
        options: { budget: "budget-1", month: "2026-06", sources: " , " },
        dependencies: { createClient: () => clientFixture({}) },
      }),
    ).rejects.toThrow("At least one source category ID is required");
  });
});

type SnapshotFixture = {
  readonly budgeted: number;
  readonly balance: number;
};

function clientFixture(snapshots: Record<string, SnapshotFixture>): BudgetClient & YnabCatalogClient {
  return {
    getCategoryMonth: vi.fn(async ({ month, categoryId }: { month: string; categoryId: string }) => {
      const snapshot = snapshots[key(month, categoryId)];
      if (!snapshot) {
        throw new Error(`Missing test snapshot for ${month} ${categoryId}`);
      }

      return {
        budgeted: milliunits(snapshot.budgeted),
        activity: milliunits(0),
        balance: milliunits(snapshot.balance),
      };
    }),
    updateCategoryBudgeted: vi.fn(),
    listBudgets: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([
      {
        id: "negative-1",
        name: "Dining",
        categoryGroupId: "group-1",
        categoryGroupName: "Everyday",
        hidden: false,
      },
      {
        id: "source-1",
        name: "Vacation",
        categoryGroupId: "group-2",
        categoryGroupName: "Savings",
        hidden: false,
      },
      {
        id: "source-2",
        name: "Buffer",
        categoryGroupId: "group-2",
        categoryGroupName: "Savings",
        hidden: false,
      },
    ]),
  };
}

function key(month: string, categoryId: string): string {
  return `${parseBudgetMonth(month)}:${categoryId}`;
}

function envFixture() {
  return {
    ynabAccessToken: "token",
    rulesFile: "rules.json",
    auditLogFile: "audit.jsonl",
  };
}
