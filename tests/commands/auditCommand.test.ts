import { describe, expect, it, vi } from "vitest";
import {
  auditInspectCommand,
  auditStatusCommand,
  formatAuditInspect,
  formatAuditStatus,
} from "../../src/commands/auditCommand.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import type { OperationAuditEntryFilter, OperationAuditScan } from "../../src/audit/auditLog.js";

describe("audit command", () => {
  it("lists pending recovery entries from the configured audit log", async () => {
    const write = vi.fn();
    const scanOperationAuditEntries = vi.fn().mockResolvedValue(scanFixture());
    const createAuditLogReader = vi.fn().mockReturnValue({ scanOperationAuditEntries });

    await auditStatusCommand({
      env: { auditLogFile: "default-audit.jsonl" },
      options: { month: "2026-07", budget: "budget-1", rule: "transfer-1", auditLog: "custom-audit.jsonl" },
      stdout: { write },
      dependencies: { createAuditLogReader },
    });

    expect(createAuditLogReader).toHaveBeenCalledWith("custom-audit.jsonl");
    expect(scanOperationAuditEntries).toHaveBeenCalledWith({
      state: "claimed",
      month: parseBudgetMonth("2026-07"),
      budgetId: "budget-1",
      ruleId: "transfer-1",
    } satisfies OperationAuditEntryFilter);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("pending-recovery: transfer-1"));
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("source source (Savings) budgeted: $100.00 -> $50.00 (-$50.00)"),
    );
  });

  it("prints an empty status message when no pending recovery entries match", async () => {
    const write = vi.fn();

    await auditStatusCommand({
      env: { auditLogFile: "audit.jsonl" },
      options: {},
      stdout: { write },
      dependencies: {
        createAuditLogReader: () => ({ scanOperationAuditEntries: async () => ({ entries: [], ignoredLineCount: 0 }) }),
      },
    });

    expect(write).toHaveBeenCalledWith("No pending recovery operations found.\n");
  });

  it("inspects an exact audit key and reports none when missing", async () => {
    const write = vi.fn();
    const scanOperationAuditEntries = vi.fn().mockResolvedValue({ entries: [], ignoredLineCount: 0 });

    await auditInspectCommand({
      env: { auditLogFile: "audit.jsonl" },
      options: { budget: "budget-1", rule: "transfer-1", month: "2026-07" },
      stdout: { write },
      dependencies: { createAuditLogReader: () => ({ scanOperationAuditEntries }) },
    });

    expect(scanOperationAuditEntries).toHaveBeenCalledWith({
      budgetId: "budget-1",
      ruleId: "transfer-1",
      month: parseBudgetMonth("2026-07"),
    });
    expect(write).toHaveBeenCalledWith(
      `${[
        "none: transfer-1",
        "  budgetId: budget-1",
        "  month: 2026-07",
        "  no audit records found for this budget/rule/month",
      ].join("\n")}\n`,
    );
  });

  it("formats applied entries without claim payload honestly", () => {
    expect(
      formatAuditInspect({
        key: { ruleId: "rule-1", budgetId: "budget-1", month: parseBudgetMonth("2026-07") },
        entry: {
          key: { ruleId: "rule-1", budgetId: "budget-1", month: parseBudgetMonth("2026-07") },
          state: "applied",
          ruleType: "monthly-category-top-up",
          appliedAt: "2026-07-01T00:00:01.000Z",
        },
        ignoredLineCount: 0,
      }),
    ).toContain("operation detail unavailable; no matching claim payload was found");
  });

  it("writes ignored-line warnings to stderr", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    await auditStatusCommand({
      env: { auditLogFile: "audit.jsonl" },
      options: {},
      stdout: { write: stdout },
      stderr: { write: stderr },
      dependencies: {
        createAuditLogReader: () => ({ scanOperationAuditEntries: async () => ({ entries: [], ignoredLineCount: 1 }) }),
      },
    });

    expect(formatAuditStatus({ entries: [], ignoredLineCount: 1 })).toBe("No pending recovery operations found.");
    expect(stdout).toHaveBeenCalledWith("No pending recovery operations found.\n");
    expect(stderr).toHaveBeenCalledWith("Warning: 1 audit log line could not be parsed and was ignored.\n");
  });
});

function scanFixture(): OperationAuditScan {
  const month = parseBudgetMonth("2026-07");

  return {
    ignoredLineCount: 0,
    entries: [
      {
        key: { ruleId: "transfer-1", budgetId: "budget-1", month },
        state: "claimed",
        ruleType: "category-available-transfer",
        claimedAt: "2026-07-01T00:00:00.000Z",
        operation: {
          ruleId: "transfer-1",
          ruleType: "category-available-transfer",
          budgetId: "budget-1",
          month,
          summary: "move $50.00 from source to destination",
          reason: "transfer-needed",
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
              budgetedBefore: milliunits(10_000),
              budgetedAfter: milliunits(60_000),
              delta: milliunits(50_000),
              role: "destination",
            },
          ],
        },
      },
    ],
  };
}
