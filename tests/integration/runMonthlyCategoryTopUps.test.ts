import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { JsonlTopUpAuditLog } from "../../src/audit/auditLog.js";
import { parseBudgetMonth, type BudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import { formatTopUpRunResults, runMonthlyCategoryTopUps } from "../../src/jobs/runMonthlyCategoryTopUps.js";
import type {
  BudgetOperationAuditRecord,
  OperationAuditKey,
  OperationAuditState,
  TopUpAuditLog,
} from "../../src/audit/auditLog.js";
import type { BudgetClient } from "../../src/ynab/budgetClient.js";

class MemoryAuditLog implements TopUpAuditLog {
  public readonly records: BudgetOperationAuditRecord[] = [];

  public async getOperationState(key: OperationAuditKey): Promise<OperationAuditState> {
    const matches = this.records.filter(
      (record) => record.ruleId === key.ruleId && record.budgetId === key.budgetId && record.month === key.month,
    );
    if (
      matches.some(
        (record) => record.kind === "budget-operation-applied" || record.kind === "monthly-category-top-up-applied",
      )
    ) {
      return "applied";
    }
    if (
      matches.some(
        (record) => record.kind === "budget-operation-claimed" || record.kind === "monthly-category-top-up-claimed",
      )
    ) {
      return "claimed";
    }
    return "none";
  }

  public async hasClaimedOrApplied(ruleId: string, month: BudgetMonth): Promise<boolean> {
    return (await this.getOperationState({ ruleId, budgetId: "budget-1", month })) !== "none";
  }

  public async append(record: BudgetOperationAuditRecord): Promise<void> {
    this.records.push(record);
  }

  public async runExclusive<T>(_ruleId: string, _month: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

describe("monthly top-up job", () => {
  it("dry-runs without updating YNAB or writing audit records", async () => {
    const auditLog = new MemoryAuditLog();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };

    const results = await runMonthlyCategoryTopUps({
      config: configFixture(),
      month: parseBudgetMonth("2026-07"),
      dryRun: true,
      budgetClient,
      auditLog,
    });

    expect(results[0]?.status).toBe("dry-run");
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
    expect(auditLog.records).toEqual([]);
  });

  it("applies once and then skips the same rule for the same month", async () => {
    const auditLog = new MemoryAuditLog();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };
    const month = parseBudgetMonth("2026-07");

    const firstRun = await runMonthlyCategoryTopUps({
      config: configFixture(),
      month,
      dryRun: false,
      budgetClient,
      auditLog,
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    const secondRun = await runMonthlyCategoryTopUps({
      config: configFixture(),
      month,
      dryRun: false,
      budgetClient,
      auditLog,
      now: new Date("2026-07-01T00:01:00.000Z"),
    });

    expect(firstRun[0]?.status).toBe("applied");
    expect(secondRun[0]?.status).toBe("skipped-already-applied");
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledTimes(1);
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month,
      categoryId: "category-1",
      budgeted: 75_000,
    });
    expect(auditLog.records.map((record) => record.kind)).toEqual([
      "budget-operation-claimed",
      "budget-operation-applied",
    ]);
  });

  it("dry-runs and apply-runs agree when a rule already applied this month", async () => {
    const auditLog = new MemoryAuditLog();
    const month = parseBudgetMonth("2026-07");
    await auditLog.append({
      kind: "monthly-category-top-up-applied",
      ruleId: "rule-1",
      budgetId: "budget-1",
      categoryId: "category-1",
      month,
      assignmentAmount: milliunits(50_000),
      budgetedAfter: milliunits(75_000),
      appliedAt: "2026-07-01T00:00:00.000Z",
    });
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(75_000),
        activity: milliunits(-25_000),
        balance: milliunits(125_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };

    const dryRun = await runMonthlyCategoryTopUps({
      config: configFixture(),
      month,
      dryRun: true,
      budgetClient,
      auditLog,
    });
    const applyRun = await runMonthlyCategoryTopUps({
      config: configFixture(),
      month,
      dryRun: false,
      budgetClient,
      auditLog,
    });

    expect(dryRun[0]?.status).toBe("skipped-already-applied");
    expect(applyRun[0]?.status).toBe("skipped-already-applied");
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
  });

  it("serializes overlapping apply runs so only one run mutates YNAB", async () => {
    const auditLog = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-job-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn().mockResolvedValue(undefined),
    };

    const [firstRun, secondRun] = await Promise.all([
      runMonthlyCategoryTopUps({ config: configFixture(), month, dryRun: false, budgetClient, auditLog }),
      runMonthlyCategoryTopUps({ config: configFixture(), month, dryRun: false, budgetClient, auditLog }),
    ]);

    expect([firstRun[0]?.status, secondRun[0]?.status].sort()).toEqual(["applied", "skipped-already-applied"]);
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledTimes(1);
  });

  it("skips no-op rules and prints an auditable summary", async () => {
    const results = await runMonthlyCategoryTopUps({
      config: configFixture(),
      month: parseBudgetMonth("2026-07"),
      dryRun: false,
      budgetClient: {
        getCategoryMonth: vi.fn().mockResolvedValue({
          budgeted: milliunits(25_000),
          activity: milliunits(0),
          balance: milliunits(250_000),
        }),
        updateCategoryBudgeted: vi.fn(),
      },
      auditLog: new MemoryAuditLog(),
    });

    expect(results[0]?.status).toBe("skipped-no-op");
    expect(formatTopUpRunResults(results)).toContain("assign $0.00");
  });

  it("applies a transfer rule as two child updates under one audited operation", async () => {
    const auditLog = new MemoryAuditLog();
    const month = parseBudgetMonth("2026-07");
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockImplementation(async ({ categoryId }: { categoryId: string }) => {
        if (categoryId === "source") {
          return { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(200_000) };
        }

        return { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(10_000) };
      }),
      updateCategoryBudgeted: vi.fn(),
    };

    const results = await runMonthlyCategoryTopUps({
      config: transferConfigFixture(),
      month,
      dryRun: false,
      budgetClient,
      auditLog,
      now: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(results[0]?.status).toBe("applied");
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledTimes(2);
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenNthCalledWith(1, {
      budgetId: "budget-1",
      month,
      categoryId: "source",
      budgeted: 50_000,
    });
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenNthCalledWith(2, {
      budgetId: "budget-1",
      month,
      categoryId: "destination",
      budgeted: 60_000,
    });
    expect(auditLog.records.map((record) => record.kind)).toEqual([
      "budget-operation-claimed",
      "budget-operation-applied",
    ]);
    expect(auditLog.records[0]).toMatchObject({
      kind: "budget-operation-claimed",
      ruleId: "transfer-1",
      operation: { updates: [{ categoryId: "source" }, { categoryId: "destination" }] },
    });
  });

  it("surfaces pending recovery after a transfer fails after its claim", async () => {
    const auditLog = new MemoryAuditLog();
    const month = parseBudgetMonth("2026-07");
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockImplementation(async ({ categoryId }: { categoryId: string }) => {
        if (categoryId === "source") {
          return { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(200_000) };
        }

        return { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(10_000) };
      }),
      updateCategoryBudgeted: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("YNAB failed")),
    };

    await expect(
      runMonthlyCategoryTopUps({
        config: transferConfigFixture(),
        month,
        dryRun: false,
        budgetClient,
        auditLog,
        now: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("YNAB failed");

    const retry = await runMonthlyCategoryTopUps({
      config: transferConfigFixture(),
      month,
      dryRun: false,
      budgetClient,
      auditLog,
      now: new Date("2026-07-01T00:01:00.000Z"),
    });

    expect(auditLog.records.map((record) => record.kind)).toEqual(["budget-operation-claimed"]);
    expect(retry[0]?.status).toBe("skipped-pending-recovery");
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledTimes(2);
  });

  it("forwards negative source budgeted values through the apply path", async () => {
    const auditLog = new MemoryAuditLog();
    const month = parseBudgetMonth("2026-07");
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockImplementation(async ({ categoryId }: { categoryId: string }) => {
        if (categoryId === "source") {
          return { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(100_000) };
        }

        return { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) };
      }),
      updateCategoryBudgeted: vi.fn(),
    };

    await runMonthlyCategoryTopUps({
      config: {
        rules: [
          {
            ...transferRuleFixture(),
            amount: { type: "fixed", amount: milliunits(75_000) },
            leaveAvailable: milliunits(25_000),
          },
        ],
      },
      month,
      dryRun: false,
      budgetClient,
      auditLog,
    });

    expect(budgetClient.updateCategoryBudgeted).toHaveBeenNthCalledWith(1, {
      budgetId: "budget-1",
      month,
      categoryId: "source",
      budgeted: -65_000,
    });
  });

  it("plans later rules from snapshots updated by earlier rules in the same run", async () => {
    const auditLog = new MemoryAuditLog();
    const month = parseBudgetMonth("2026-07");
    const snapshots = new Map([
      ["source", { budgeted: milliunits(100_000), activity: milliunits(0), balance: milliunits(100_000) }],
      ["middle", { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) }],
      ["destination", { budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) }],
    ]);
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockImplementation(async ({ categoryId }: { categoryId: string }) => {
        const snapshot = snapshots.get(categoryId);
        if (!snapshot) {
          throw new Error(`missing snapshot for ${categoryId}`);
        }

        return { ...snapshot };
      }),
      updateCategoryBudgeted: vi
        .fn()
        .mockImplementation(async ({ categoryId, budgeted }: { categoryId: string; budgeted: number }) => {
          const snapshot = snapshots.get(categoryId);
          if (!snapshot) {
            throw new Error(`missing snapshot for ${categoryId}`);
          }

          const delta = milliunits(budgeted - snapshot.budgeted);
          snapshots.set(categoryId, {
            ...snapshot,
            budgeted: milliunits(budgeted),
            balance: milliunits(snapshot.balance + delta),
          });
        }),
    };

    const results = await runMonthlyCategoryTopUps({
      config: {
        rules: [
          {
            id: "source-to-middle",
            type: "category-available-transfer",
            enabled: true,
            budgetId: "budget-1",
            fromCategoryId: "source",
            toCategoryId: "middle",
            amount: { type: "fixed", amount: milliunits(50_000) },
            leaveAvailable: milliunits(0),
          },
          {
            id: "middle-to-destination",
            type: "category-available-transfer",
            enabled: true,
            budgetId: "budget-1",
            fromCategoryId: "middle",
            toCategoryId: "destination",
            amount: { type: "fixed", amount: milliunits(50_000) },
            leaveAvailable: milliunits(0),
          },
        ],
      },
      month,
      dryRun: false,
      budgetClient,
      auditLog,
    });

    expect(results.map((result) => result.status)).toEqual(["applied", "applied"]);
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenNthCalledWith(3, {
      budgetId: "budget-1",
      month,
      categoryId: "middle",
      budgeted: 0,
    });
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenNthCalledWith(4, {
      budgetId: "budget-1",
      month,
      categoryId: "destination",
      budgeted: 50_000,
    });
  });

  it("does not read, write, or audit disabled rules", async () => {
    const auditLog = new MemoryAuditLog();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn(),
      updateCategoryBudgeted: vi.fn(),
    };

    const results = await runMonthlyCategoryTopUps({
      config: disabledConfigFixture(),
      month: parseBudgetMonth("2026-07"),
      dryRun: false,
      budgetClient,
      auditLog,
    });

    expect(results).toEqual([]);
    expect(budgetClient.getCategoryMonth).not.toHaveBeenCalled();
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
    expect(auditLog.records).toEqual([]);
  });
});

function configFixture() {
  return {
    rules: [
      {
        id: "rule-1",
        type: "monthly-category-top-up" as const,
        enabled: true,
        budgetId: "budget-1",
        categoryId: "category-1",
        monthlyAmount: milliunits(50_000),
        targetBalance: milliunits(200_000),
      },
    ],
  };
}

function disabledConfigFixture() {
  const [rule] = configFixture().rules;
  if (!rule) {
    throw new Error("missing fixture rule");
  }

  return { rules: [{ ...rule, enabled: false }] };
}

function transferRuleFixture() {
  return {
    id: "transfer-1",
    type: "category-available-transfer" as const,
    enabled: true,
    budgetId: "budget-1",
    fromCategoryId: "source",
    toCategoryId: "destination",
    amount: { type: "fixed" as const, amount: milliunits(50_000) },
    leaveAvailable: milliunits(25_000),
  };
}

function transferConfigFixture() {
  return { rules: [transferRuleFixture()] };
}
