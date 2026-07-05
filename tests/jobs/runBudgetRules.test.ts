import { describe, expect, it } from "vitest";
import type { PlannedBudgetOperation } from "../../src/domain/budgetOperation.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import { formatBudgetRuleRunResults, summarizeBudgetRuleRun } from "../../src/jobs/runBudgetRules.js";

describe("budget rule run summary", () => {
  it("counts dry-run, applied, skipped, no-op, disabled, and pending-recovery outcomes", () => {
    const results = [
      { operation: topUpOperation("dry-run-rule", milliunits(25_000)), status: "dry-run" as const },
      { operation: transferOperation("applied-transfer", milliunits(50_000)), status: "applied" as const },
      {
        operation: topUpOperation("already-applied-rule", milliunits(10_000)),
        status: "skipped-already-applied" as const,
      },
      { operation: topUpOperation("no-op-rule", milliunits(0)), status: "skipped-no-op" as const },
      {
        operation: transferOperation("pending-recovery-transfer", milliunits(75_000)),
        status: "skipped-pending-recovery" as const,
      },
      {
        status: "skipped-disabled" as const,
        ruleId: "disabled-rule",
        ruleType: "monthly-category-top-up" as const,
        budgetId: "budget-1",
        month: parseBudgetMonth("2026-07"),
        reason: "rule-disabled" as const,
      },
    ];

    expect(summarizeBudgetRuleRun({ results })).toEqual({
      totalRulesConsidered: 6,
      plannedOperations: 1,
      appliedOperations: 1,
      skippedAlreadyAppliedOperations: 1,
      noOpOperations: 1,
      pendingRecoveryOperations: 1,
      skippedDisabledRules: 1,
      totalMovedOrBudgeted: 75_000,
    });
  });

  it("prints a concise summary block after detailed output", () => {
    const output = formatBudgetRuleRunResults([
      { operation: transferOperation("transfer-1", milliunits(50_000)), status: "dry-run" },
      {
        status: "skipped-disabled",
        ruleId: "disabled-rule",
        ruleType: "monthly-category-top-up",
        budgetId: "budget-1",
        month: parseBudgetMonth("2026-07"),
        reason: "rule-disabled",
      },
    ]);

    expect(output).toContain("dry-run: transfer-1 (category-available-transfer)");
    expect(output).toContain("reason: transfer needed from the source category to the destination category");
    expect(output).toContain("skipped-disabled: disabled-rule (monthly-category-top-up)");
    expect(output).toContain("reason: skipped because the rule is disabled in config");
    expect(output).toContain("Summary:\n  rules considered: 2");
    expect(output).toContain("  planned operations: 1");
    expect(output).toContain("  skipped disabled rules: 1");
    expect(output).toContain("  total moved or budgeted: $50.00");
  });

  it("prints no-op explanations from operation reasons", () => {
    const output = formatBudgetRuleRunResults([
      { operation: topUpOperation("top-up-met", milliunits(0)), status: "skipped-no-op" },
      { operation: transferOperation("transfer-zero", milliunits(0)), status: "skipped-no-op" },
      {
        operation: {
          ...transferOperation("transfer-rounded-zero", milliunits(0)),
          reason: "amount-policy-rounded-to-zero",
        },
        status: "skipped-no-op",
      },
    ]);

    expect(output).toContain("reason: no-op because the category available balance is already at or above the target");
    expect(output).toContain(
      "reason: no-op because source available balance is at or below the configured leaveAvailable floor",
    );
    expect(output).toContain("reason: no-op because the amount policy calculated $0.00 to move");
  });

  it("prints audit-state skip explanations before operation reasons", () => {
    const output = formatBudgetRuleRunResults([
      { operation: topUpOperation("already-applied", milliunits(25_000)), status: "skipped-already-applied" },
      { operation: transferOperation("pending-recovery", milliunits(50_000)), status: "skipped-pending-recovery" },
    ]);

    expect(output).toContain(
      "reason: skipped because the audit log already records this operation as applied for the budget/rule/month",
    );
    expect(output).toContain(
      "reason: skipped because the audit log has a claim without an applied record; inspect pending recovery before retrying",
    );
  });

  it("prints category names alongside IDs when operations are enriched", () => {
    const output = formatBudgetRuleRunResults([
      {
        operation: {
          ...transferOperation("transfer-1", milliunits(50_000)),
          summary: "move $50.00 from source (Savings) to destination (Groceries)",
          updates: [
            {
              categoryId: "source",
              categoryName: "Savings",
              budgetedBefore: milliunits(100_000),
              budgetedAfter: milliunits(50_000),
              delta: milliunits(-50_000),
              role: "source",
            },
            {
              categoryId: "destination",
              categoryName: "Groceries",
              budgetedBefore: milliunits(0),
              budgetedAfter: milliunits(50_000),
              delta: milliunits(50_000),
              role: "destination",
            },
          ],
        },
        status: "dry-run",
      },
    ]);

    expect(output).toContain("move $50.00 from source (Savings) to destination (Groceries)");
    expect(output).toContain("source (Savings) budgeted: $100.00 -> $50.00 (-$50.00)");
    expect(output).toContain("destination (Groceries) budgeted: $0.00 -> $50.00 (+$50.00)");
  });
});

function topUpOperation(ruleId: string, delta: number): PlannedBudgetOperation {
  return {
    ruleId,
    ruleType: "monthly-category-top-up",
    budgetId: "budget-1",
    month: parseBudgetMonth("2026-07"),
    summary: `assign ${delta} milliunits`,
    reason: delta === 0 ? "target-already-met" : "top-up-needed",
    updates: [
      {
        categoryId: "category-1",
        budgetedBefore: milliunits(10_000),
        budgetedAfter: milliunits(10_000 + delta),
        delta: milliunits(delta),
        role: "primary",
      },
    ],
  };
}

function transferOperation(ruleId: string, amount: number): PlannedBudgetOperation {
  return {
    ruleId,
    ruleType: "category-available-transfer",
    budgetId: "budget-1",
    month: parseBudgetMonth("2026-07"),
    summary: `move ${amount} milliunits`,
    reason: amount === 0 ? "no-movable-available" : "transfer-needed",
    updates: [
      {
        categoryId: "source",
        budgetedBefore: milliunits(100_000),
        budgetedAfter: milliunits(100_000 - amount),
        delta: milliunits(-amount),
        role: "source",
      },
      {
        categoryId: "destination",
        budgetedBefore: milliunits(0),
        budgetedAfter: milliunits(amount),
        delta: milliunits(amount),
        role: "destination",
      },
    ],
  };
}
