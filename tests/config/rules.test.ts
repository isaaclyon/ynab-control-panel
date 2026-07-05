import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRulesConfig, parseRulesConfig } from "../../src/config/rules.js";

describe("rules config parsing", () => {
  it("parses external JSON into domain rules at the boundary", () => {
    const config = parseRulesConfig({
      rules: [
        {
          id: "rule-1",
          type: "monthly-category-top-up",
          budgetId: "budget-1",
          categoryId: "category-1",
          monthlyAmount: "250.00",
          targetBalance: "1000.00"
        }
      ]
    });

    expect(config.rules[0]?.monthlyAmount).toBe(250_000);
    expect(config.rules[0]?.targetBalance).toBe(1_000_000);
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
            targetBalance: "-1"
          }
        ]
      })
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
            targetBalance: "1000.00"
          }
        ]
      }),
      "utf8"
    );

    await expect(loadRulesConfig(path)).resolves.toMatchObject({
      rules: [{ monthlyAmount: 250_000, targetBalance: 1_000_000 }]
    });
  });
});
