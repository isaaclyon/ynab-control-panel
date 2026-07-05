import { describe, expect, it, vi } from "vitest";
import { runTopUpsCommand } from "../../src/commands/runTopUpsCommand.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import type {
  BudgetOperationAuditRecord,
  OperationAuditKey,
  OperationAuditState,
  TopUpAuditLog,
} from "../../src/audit/auditLog.js";
import type { BudgetClient, YnabCatalogClient } from "../../src/ynab/budgetClient.js";

class MemoryAuditLog implements TopUpAuditLog {
  public readonly records: BudgetOperationAuditRecord[] = [];

  public async getOperationState(_key: OperationAuditKey): Promise<OperationAuditState> {
    return "none";
  }

  public async hasClaimedOrApplied(): Promise<boolean> {
    return false;
  }

  public async append(record: BudgetOperationAuditRecord): Promise<void> {
    this.records.push(record);
  }

  public async runExclusive<T>(_ruleId: string, _month: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

describe("run top-ups command", () => {
  it("wires config, YNAB client, audit log, and stdout with explicit month", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };
    const loadRulesConfig = vi.fn().mockResolvedValue(configFixture());
    const createBudgetClient = vi.fn().mockReturnValue(budgetClient);
    const createAuditLog = vi.fn().mockReturnValue(new MemoryAuditLog());

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { month: "2026-07", rules: "custom-rules.json", apply: true },
      stdout: { write },
      dependencies: {
        loadRulesConfig,
        createBudgetClient,
        createAuditLog,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(loadRulesConfig).toHaveBeenCalledWith("custom-rules.json");
    expect(createBudgetClient).toHaveBeenCalledWith("token");
    expect(createAuditLog).toHaveBeenCalledWith("audit.jsonl");
    expect(budgetClient.updateCategoryBudgeted).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month: "2026-07",
      categoryId: "category-1",
      budgeted: 75_000,
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("applied: rule-1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Summary:\n  rules considered: 1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("  applied operations: 1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("  total moved or budgeted: $50.00"));
  });

  it("defaults to the configured rules file and current budget month", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };
    const loadRulesConfig = vi.fn().mockResolvedValue(configFixture());

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false },
      stdout: { write },
      dependencies: {
        loadRulesConfig,
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(loadRulesConfig).toHaveBeenCalledWith("default-rules.json");
    expect(budgetClient.getCategoryMonth).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month: "2026-08",
      categoryId: "category-1",
    });
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("dry-run: rule-1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("  planned operations: 1"));
  });

  it("enriches operation output with category names from the YNAB catalog", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient & YnabCatalogClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
      listBudgets: vi.fn(),
      listCategories: vi.fn().mockResolvedValue([
        {
          id: "category-1",
          name: "Groceries",
          categoryGroupId: "group-1",
          categoryGroupName: "Everyday",
          hidden: false,
        },
      ]),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(configFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(budgetClient.listCategories).toHaveBeenCalledWith({ budgetId: "budget-1" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("category-1 (Groceries) budgeted"));
  });

  it("continues with ID-only output when category-name lookup fails", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient & YnabCatalogClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
      listBudgets: vi.fn(),
      listCategories: vi.fn().mockRejectedValue(new Error("YNAB catalog unavailable")),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(configFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining("category-1 budgeted"));
    expect(write).toHaveBeenCalledWith(expect.not.stringContaining("category-1 ("));
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
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
