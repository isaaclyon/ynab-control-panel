import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { JsonlTopUpAuditLog } from "../../src/audit/auditLog.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import { formatTopUpRunResults, runMonthlyCategoryTopUps } from "../../src/jobs/runMonthlyCategoryTopUps.js";
import type { TopUpAuditLog, TopUpAuditRecord } from "../../src/audit/auditLog.js";
import type { BudgetClient } from "../../src/ynab/budgetClient.js";

class MemoryAuditLog implements TopUpAuditLog {
  public readonly records: TopUpAuditRecord[] = [];

  public async hasClaimedOrApplied(ruleId: string, month: string): Promise<boolean> {
    return this.records.some((record) => record.ruleId === ruleId && record.month === month);
  }

  public async append(record: TopUpAuditRecord): Promise<void> {
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
    expect(secondRun[0]?.status).toBe("skipped-already-claimed");
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledTimes(1);
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month,
      categoryId: "category-1",
      budgeted: 75_000,
    });
    expect(auditLog.records.map((record) => record.kind)).toEqual([
      "monthly-category-top-up-claimed",
      "monthly-category-top-up-applied",
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

    expect(dryRun[0]?.status).toBe("skipped-already-claimed");
    expect(applyRun[0]?.status).toBe("skipped-already-claimed");
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

    expect([firstRun[0]?.status, secondRun[0]?.status].sort()).toEqual(["applied", "skipped-already-claimed"]);
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
    expect(formatTopUpRunResults(results)).toContain("assignment: $0.00");
  });
});

function configFixture() {
  return {
    rules: [
      {
        id: "rule-1",
        type: "monthly-category-top-up" as const,
        budgetId: "budget-1",
        categoryId: "category-1",
        monthlyAmount: milliunits(50_000),
        targetBalance: milliunits(200_000),
      },
    ],
  };
}
