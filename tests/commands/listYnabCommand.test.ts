import { describe, expect, it, vi } from "vitest";
import {
  formatBudgetList,
  formatCategoryList,
  listBudgetsCommand,
  listCategoriesCommand
} from "../../src/commands/listYnabCommand.js";
import type { YnabCatalogClient } from "../../src/ynab/budgetClient.js";

describe("list YNAB command", () => {
  it("lists budgets through a read-only catalog client", async () => {
    const write = vi.fn();
    const client: YnabCatalogClient = {
      listBudgets: vi.fn().mockResolvedValue([{ id: "budget-1", name: "Main Budget", isDefault: true }]),
      listCategories: vi.fn()
    };
    const createCatalogClient = vi.fn().mockReturnValue(client);

    await listBudgetsCommand({
      env: envFixture(),
      stdout: { write },
      dependencies: { createCatalogClient }
    });

    expect(createCatalogClient).toHaveBeenCalledWith("token");
    expect(client.listBudgets).toHaveBeenCalledOnce();
    expect(client.listCategories).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("budget-1\tMain Budget\tyes\n"));
  });

  it("lists categories for the requested budget through a read-only catalog client", async () => {
    const write = vi.fn();
    const client: YnabCatalogClient = {
      listBudgets: vi.fn(),
      listCategories: vi.fn().mockResolvedValue([
        {
          id: "category-1",
          name: "Rent",
          categoryGroupId: "group-1",
          categoryGroupName: "Bills",
          hidden: false
        }
      ])
    };

    await listCategoriesCommand({
      env: envFixture(),
      options: { budget: "budget-1" },
      stdout: { write },
      dependencies: { createCatalogClient: () => client }
    });

    expect(client.listBudgets).not.toHaveBeenCalled();
    expect(client.listCategories).toHaveBeenCalledWith({ budgetId: "budget-1" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("category-1\tBills\tRent\t\n"));
  });

  it("formats budget output with an explicit local privacy notice", () => {
    expect(
      formatBudgetList([
        { id: "budget-1", name: "Main Budget", isDefault: true },
        { id: "budget-2", name: "Archive\nBudget", isDefault: false }
      ])
    ).toBe(
      [
        "Full local output: YNAB names and IDs are not redacted so you can copy them into config/rules.json.",
        "budgetId\tname\tdefault",
        "budget-1\tMain Budget\tyes",
        "budget-2\tArchive Budget\t"
      ].join("\n")
    );
  });

  it("formats category output with hidden categories flagged", () => {
    expect(
      formatCategoryList("budget-1", [
        {
          id: "category-1",
          name: "Rent",
          categoryGroupId: "group-1",
          categoryGroupName: "Bills",
          hidden: false
        },
        {
          id: "category-2",
          name: "Emergency Fund",
          categoryGroupId: "group-2",
          categoryGroupName: "Savings\tGoals",
          hidden: true
        }
      ])
    ).toBe(
      [
        "Full local output: YNAB names and IDs are not redacted so you can copy them into config/rules.json.",
        "Categories for budgetId: budget-1",
        "categoryId\tcategoryGroup\tcategory\tflags",
        "category-1\tBills\tRent\t",
        "category-2\tSavings Goals\tEmergency Fund\thidden"
      ].join("\n")
    );
  });
});

function envFixture() {
  return {
    ynabAccessToken: "token",
    rulesFile: "rules.json",
    auditLogFile: "audit.jsonl"
  };
}
