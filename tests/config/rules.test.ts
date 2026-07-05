import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRulesConfig, parseRulesConfig } from "../../src/config/rules.js";

describe("rules config parsing", () => {
  it("parses external JSON into top-up domain rules at the boundary", () => {
    const config = parseRulesConfig({
      rules: [
        {
          id: "rule-1",
          type: "monthly-category-top-up",
          description: "  Emergency fund target  ",
          budgetId: "budget-1",
          categoryId: "category-1",
          monthlyAmount: "250.00",
          targetBalance: "1000.00",
        },
      ],
    });

    const rule = config.rules[0];
    expect(rule?.type).toBe("monthly-category-top-up");
    if (rule?.type !== "monthly-category-top-up") {
      throw new Error("expected top-up rule");
    }

    expect(rule.enabled).toBe(true);
    expect(rule.description).toBe("Emergency fund target");
    expect(rule.monthlyAmount).toBe(250_000);
    expect(rule.targetBalance).toBe(1_000_000);
  });

  it("parses transfer rules and amount policies into domain milliunits", () => {
    const config = parseRulesConfig({
      rules: [
        {
          id: "sweep-dining-extra",
          type: "category-available-transfer",
          description: "Sweep dining leftovers",
          enabled: false,
          budgetId: "budget-1",
          fromCategoryId: "dining",
          toCategoryId: "vacation",
          amount: { type: "percent-of-available", percent: 50, max: "100.00" },
          leaveAvailable: "25.00",
        },
      ],
    });

    const rule = config.rules[0];
    expect(rule?.type).toBe("category-available-transfer");
    if (rule?.type !== "category-available-transfer") {
      throw new Error("expected transfer rule");
    }

    expect(rule.enabled).toBe(false);
    expect(rule.description).toBe("Sweep dining leftovers");
    expect(rule.amount).toEqual({ type: "percent-of-available", percent: 50, max: 100_000 });
    expect(rule.leaveAvailable).toBe(25_000);
  });

  it("rejects invalid rule payloads instead of letting loose types enter the app", () => {
    expect(() =>
      parseRulesConfig({
        rules: [
          {
            id: "rule-1",
            type: "monthly-category-top-up",
            budgetId: "budget-1",
            categoryId: "category-1",
            monthlyAmount: "0",
            targetBalance: "-1",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects blank rule descriptions", () => {
    expect(() =>
      parseRulesConfig({
        rules: [
          {
            id: "rule-1",
            type: "monthly-category-top-up",
            description: "  ",
            budgetId: "budget-1",
            categoryId: "category-1",
            monthlyAmount: "1.00",
            targetBalance: "1.00",
          },
        ],
      }),
    ).toThrow(/description cannot be blank/);
  });

  it("rejects duplicate rule ids and transfer rules with identical source/destination categories", () => {
    expect(() =>
      parseRulesConfig({
        rules: [
          {
            id: "rule-1",
            type: "monthly-category-top-up",
            budgetId: "budget-1",
            categoryId: "category-1",
            monthlyAmount: "1.00",
            targetBalance: "1.00",
          },
          {
            id: "rule-1",
            type: "monthly-category-top-up",
            budgetId: "budget-1",
            categoryId: "category-2",
            monthlyAmount: "1.00",
            targetBalance: "1.00",
          },
        ],
      }),
    ).toThrow(/Duplicate rule id/);

    expect(() =>
      parseRulesConfig({
        rules: [
          {
            id: "bad-transfer",
            type: "category-available-transfer",
            budgetId: "budget-1",
            fromCategoryId: "category-1",
            toCategoryId: "category-1",
            amount: { type: "fixed", amount: "1.00" },
            leaveAvailable: "0.00",
          },
        ],
      }),
    ).toThrow();
  });

  it("loads rules from JSON files", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ynab-rules-")), "rules.json");
    await writeFile(
      path,
      JSON.stringify({
        rules: [
          {
            id: "rule-1",
            type: "monthly-category-top-up",
            budgetId: "budget-1",
            categoryId: "category-1",
            monthlyAmount: "250.00",
            targetBalance: "1000.00",
          },
        ],
      }),
      "utf8",
    );

    await expect(loadRulesConfig(path)).resolves.toMatchObject({
      rules: [{ monthlyAmount: 250_000, targetBalance: 1_000_000 }],
    });
  });
});
