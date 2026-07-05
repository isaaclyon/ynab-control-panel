import { describe, expect, it, vi } from "vitest";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import { YnabBudgetClient } from "../../src/ynab/ynabBudgetClient.js";

describe("YNAB budget client", () => {
  it("reads a category snapshot from the YNAB month category endpoint", async () => {
    const api = apiFixture({
      getMonthCategoryById: vi.fn().mockResolvedValue({
        data: {
          category: { id: "category-1", budgeted: 12_000, activity: -1_000, balance: 50_000 }
        }
      })
    });
    const client = new YnabBudgetClient("token", api);

    await expect(
      client.getCategoryMonth({ budgetId: "budget-1", month: parseBudgetMonth("2026-07"), categoryId: "category-1" })
    ).resolves.toEqual({
      budgeted: 12_000,
      activity: -1_000,
      balance: 50_000
    });
    expect(api.categories.getMonthCategoryById).toHaveBeenCalledWith("budget-1", "2026-07-01", "category-1");
  });

  it("throws when YNAB returns a different category than requested", async () => {
    const client = new YnabBudgetClient(
      "token",
      apiFixture({
        getMonthCategoryById: vi.fn().mockResolvedValue({
          data: { category: { id: "other", budgeted: 0, activity: 0, balance: 0 } }
        })
      })
    );

    await expect(
      client.getCategoryMonth({ budgetId: "budget-1", month: parseBudgetMonth("2026-07"), categoryId: "missing" })
    ).rejects.toThrow("missing");
  });

  it("updates a category's budgeted amount through the YNAB category endpoint", async () => {
    const updateMonthCategory = vi.fn().mockResolvedValue({});
    const client = new YnabBudgetClient("token", apiFixture({ updateMonthCategory }));

    await client.updateCategoryBudgeted({
      budgetId: "budget-1",
      month: parseBudgetMonth("2026-07"),
      categoryId: "category-1",
      budgeted: milliunits(75_000)
    });

    expect(updateMonthCategory).toHaveBeenCalledWith("budget-1", "2026-07-01", "category-1", {
      category: { budgeted: 75_000 }
    });
  });

  it("lists YNAB budgets without account details", async () => {
    const getPlans = vi.fn().mockResolvedValue({
      data: {
        plans: [
          { id: "budget-1", name: "Main Budget" },
          { id: "budget-2", name: "Archive" }
        ],
        default_plan: { id: "budget-1", name: "Main Budget" }
      }
    });
    const client = new YnabBudgetClient("token", apiFixture({ getPlans }));

    await expect(client.listBudgets()).resolves.toEqual([
      { id: "budget-1", name: "Main Budget", isDefault: true },
      { id: "budget-2", name: "Archive", isDefault: false }
    ]);
    expect(getPlans).toHaveBeenCalledWith(false);
  });

  it("lists copyable non-internal, non-deleted categories with hidden categories flagged", async () => {
    const getCategories = vi.fn().mockResolvedValue({
      data: {
        category_groups: [
          {
            id: "group-1",
            name: "Bills",
            hidden: false,
            internal: false,
            deleted: false,
            categories: [
              {
                id: "category-1",
                name: "Rent",
                category_group_id: "group-1",
                hidden: false,
                internal: false,
                deleted: false
              },
              {
                id: "category-2",
                name: "Old Bill",
                category_group_id: "group-1",
                hidden: true,
                internal: false,
                deleted: false
              },
              {
                id: "deleted-category",
                name: "Deleted",
                category_group_id: "group-1",
                hidden: false,
                internal: false,
                deleted: true
              }
            ]
          },
          {
            id: "internal-group",
            name: "Internal",
            hidden: false,
            internal: true,
            deleted: false,
            categories: [
              {
                id: "internal-category",
                name: "Internal",
                category_group_id: "internal-group",
                hidden: false,
                internal: true,
                deleted: false
              }
            ]
          }
        ]
      }
    });
    const client = new YnabBudgetClient("token", apiFixture({ getCategories }));

    await expect(client.listCategories({ budgetId: "budget-1" })).resolves.toEqual([
      {
        id: "category-1",
        name: "Rent",
        categoryGroupId: "group-1",
        categoryGroupName: "Bills",
        hidden: false
      },
      {
        id: "category-2",
        name: "Old Bill",
        categoryGroupId: "group-1",
        categoryGroupName: "Bills",
        hidden: true
      }
    ]);
    expect(getCategories).toHaveBeenCalledWith("budget-1");
  });
});

function apiFixture(overrides: {
  readonly getPlans?: ReturnType<typeof vi.fn>;
  readonly getCategories?: ReturnType<typeof vi.fn>;
  readonly getMonthCategoryById?: ReturnType<typeof vi.fn>;
  readonly updateMonthCategory?: ReturnType<typeof vi.fn>;
}) {
  return {
    plans: {
      getPlans: overrides.getPlans ?? vi.fn()
    },
    categories: {
      getCategories: overrides.getCategories ?? vi.fn(),
      getMonthCategoryById: overrides.getMonthCategoryById ?? vi.fn(),
      updateMonthCategory: overrides.updateMonthCategory ?? vi.fn()
    }
  };
}
