import { describe, expect, it, vi } from "vitest";
import {
  formatRuleExplanation,
  formatRulesList,
  formatRulesValidation,
  rulesExplainCommand,
  rulesListCommand,
  rulesValidateCommand,
} from "../../src/commands/rulesCommand.js";
import { milliunits } from "../../src/domain/money.js";

describe("rules inspection commands", () => {
  it("validates local rules config without requiring YNAB dependencies", async () => {
    const write = vi.fn();
    const loadRulesConfig = vi.fn().mockResolvedValue(configFixture());

    await rulesValidateCommand({
      env: { rulesFile: "default-rules.json" },
      options: { rules: "custom-rules.json" },
      stdout: { write },
      dependencies: { loadRulesConfig },
    });

    expect(loadRulesConfig).toHaveBeenCalledWith("custom-rules.json");
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Rules config valid: custom-rules.json"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("No YNAB calls were performed."));
  });

  it("lists rule IDs, types, enabled state, budgets, categories, and descriptions", async () => {
    const write = vi.fn();
    const loadRulesConfig = vi.fn().mockResolvedValue(configFixture());

    await rulesListCommand({
      env: { rulesFile: "default-rules.json" },
      options: {},
      stdout: { write },
      dependencies: { loadRulesConfig },
    });

    expect(loadRulesConfig).toHaveBeenCalledWith("default-rules.json");
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("top-up-1\tmonthly-category-top-up\tyes\tbudget-1\tgroceries\tFund groceries"),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining(
        "transfer-1\tcategory-available-transfer\tno\tbudget-1\tdining -> vacation\tDining Vacation",
      ),
    );
  });

  it("explains one rule from local config", async () => {
    const write = vi.fn();

    await rulesExplainCommand({
      env: { rulesFile: "rules.json" },
      options: { ruleId: "transfer-1" },
      stdout: { write },
      dependencies: { loadRulesConfig: vi.fn().mockResolvedValue(configFixture()) },
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining("ruleId: transfer-1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("description: Dining Vacation"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("enabled: no"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("amount: 50% of available, capped at $100.00"));
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining(
        "effect: moves 50% of available, capped at $100.00 from dining to vacation after leaving at least $25.00 available",
      ),
    );
  });

  it("fails explain when the requested rule does not exist", async () => {
    await expect(
      rulesExplainCommand({
        env: { rulesFile: "rules.json" },
        options: { ruleId: "missing" },
        dependencies: { loadRulesConfig: vi.fn().mockResolvedValue(configFixture()) },
      }),
    ).rejects.toThrow("Rule not found: missing");
  });

  it("formats validation, list, and explanations as text-only local inspection output", () => {
    const config = configFixture();

    expect(formatRulesValidation("rules.json", config)).toContain("enabled: 1\n  disabled: 1");
    expect(formatRulesList("rules.json", config)).toContain("ruleId\ttype\tenabled\tbudgetId\tcategories\tdescription");
    const [firstRule] = config.rules;
    if (!firstRule) {
      throw new Error("missing fixture rule");
    }
    expect(formatRuleExplanation(firstRule)).toContain(
      "effect: assigns up to $50.00 to groceries until available balance reaches $200.00",
    );
  });
});

function configFixture() {
  return {
    rules: [
      {
        id: "top-up-1",
        type: "monthly-category-top-up" as const,
        description: "Fund groceries",
        enabled: true,
        budgetId: "budget-1",
        categoryId: "groceries",
        monthlyAmount: milliunits(50_000),
        targetBalance: milliunits(200_000),
      },
      {
        id: "transfer-1",
        type: "category-available-transfer" as const,
        description: "Dining\nVacation",
        enabled: false,
        budgetId: "budget-1",
        fromCategoryId: "dining",
        toCategoryId: "vacation",
        amount: { type: "percent-of-available" as const, percent: 50, max: milliunits(100_000) },
        leaveAvailable: milliunits(25_000),
      },
    ],
  };
}
