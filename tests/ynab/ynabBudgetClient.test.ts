import { describe, expect, it, vi } from "vitest";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import { YnabBudgetClient } from "../../src/ynab/ynabBudgetClient.js";

describe("YNAB budget client", () => {
  it("reads a category snapshot from the YNAB month category endpoint", async () => {
    const api = {
      categories: {
        getMonthCategoryById: vi.fn().mockResolvedValue({
          data: {
            category: { id: "category-1", budgeted: 12_000, activity: -1_000, balance: 50_000 }
          }
        }),
        updateMonthCategory: vi.fn()
      }
    };
    const client = new YnabBudgetClient("token", api);

    await expect(
      client.getCategoryMonth({ budgetId: "budget-1", month: parseBudgetMonth("2026-07"), categoryId: "category-1" })
    ).resolves.toEqual({
      budgeted: 12_000,
      activity: -1_000,
      balance: 50_000
    });
  });

  it("throws when YNAB returns a different category than requested", async () => {
    const client = new YnabBudgetClient("token", {
      categories: {
        getMonthCategoryById: vi.fn().mockResolvedValue({
          data: { category: { id: "other", budgeted: 0, activity: 0, balance: 0 } }
        }),
        updateMonthCategory: vi.fn()
      }
    });

    await expect(
      client.getCategoryMonth({ budgetId: "budget-1", month: parseBudgetMonth("2026-07"), categoryId: "missing" })
    ).rejects.toThrow("missing");
  });

  it("updates a category's budgeted amount through the YNAB category endpoint", async () => {
    const updateMonthCategory = vi.fn().mockResolvedValue({});
    const client = new YnabBudgetClient("token", {
      categories: {
        getMonthCategoryById: vi.fn(),
        updateMonthCategory
      }
    });

    await client.updateCategoryBudgeted({
      budgetId: "budget-1",
      month: parseBudgetMonth("2026-07"),
      categoryId: "category-1",
      budgeted: milliunits(75_000)
    });

    expect(updateMonthCategory).toHaveBeenCalledWith("budget-1", "2026-07", "category-1", {
      category: { budgeted: 75_000 }
    });
  });
});
