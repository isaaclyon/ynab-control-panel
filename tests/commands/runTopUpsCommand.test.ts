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

  it("prints structured JSON when requested", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(25_000),
        activity: milliunits(0),
        balance: milliunits(100_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false, json: true },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(configFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    const output = JSON.parse(write.mock.calls[0]?.[0] as string) as {
      summary: { plannedOperations: number; totalMovedOrBudgeted: number };
      results: [{ status: string; operation: { ruleId: string } }];
    };
    expect(output.summary).toMatchObject({ plannedOperations: 1, totalMovedOrBudgeted: 50_000 });
    expect(output.results[0]).toMatchObject({ status: "dry-run", operation: { ruleId: "rule-1" } });
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

  it("runs only the requested rule when --only is provided", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(10_000),
        activity: milliunits(0),
        balance: milliunits(20_000),
      }),
      updateCategoryBudgeted: vi.fn(),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false, only: "rule-2" },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(twoRuleConfigFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(budgetClient.getCategoryMonth).toHaveBeenCalledTimes(1);
    expect(budgetClient.getCategoryMonth).toHaveBeenCalledWith({
      budgetId: "budget-1",
      month: "2026-08",
      categoryId: "category-2",
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("dry-run: rule-2"));
    expect(write).toHaveBeenCalledWith(expect.not.stringContaining("rule-1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Summary:\n  rules considered: 1"));
  });

  it("reports only a selected disabled rule without YNAB reads or audit activity", async () => {
    const write = vi.fn();
    const auditLog = new MemoryAuditLog();
    const budgetClient: BudgetClient & YnabCatalogClient = {
      getCategoryMonth: vi.fn(),
      updateCategoryBudgeted: vi.fn(),
      listBudgets: vi.fn(),
      listCategories: vi.fn(),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false, only: "disabled-rule" },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(disabledOnlyConfigFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => auditLog,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(budgetClient.listCategories).not.toHaveBeenCalled();
    expect(budgetClient.getCategoryMonth).not.toHaveBeenCalled();
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
    expect(auditLog.records).toEqual([]);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("skipped-disabled: disabled-rule"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("skipped disabled rules: 1"));
  });

  it("runs only rules for the requested budget when --budget is provided", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient & YnabCatalogClient = {
      getCategoryMonth: vi.fn().mockResolvedValue({
        budgeted: milliunits(10_000),
        activity: milliunits(0),
        balance: milliunits(20_000),
      }),
      updateCategoryBudgeted: vi.fn(),
      listBudgets: vi.fn(),
      listCategories: vi.fn().mockResolvedValue([]),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false, budget: "budget-2" },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(twoBudgetConfigFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(budgetClient.listCategories).toHaveBeenCalledTimes(1);
    expect(budgetClient.listCategories).toHaveBeenCalledWith({ budgetId: "budget-2" });
    expect(budgetClient.getCategoryMonth).toHaveBeenCalledTimes(1);
    expect(budgetClient.getCategoryMonth).toHaveBeenCalledWith({
      budgetId: "budget-2",
      month: "2026-08",
      categoryId: "category-2",
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("dry-run: budget-2-rule"));
    expect(write).toHaveBeenCalledWith(expect.not.stringContaining("rule-1"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Summary:\n  rules considered: 1"));
  });

  it("does not read YNAB when --budget matches no configured rules", async () => {
    const write = vi.fn();
    const budgetClient: BudgetClient & YnabCatalogClient = {
      getCategoryMonth: vi.fn(),
      updateCategoryBudgeted: vi.fn(),
      listBudgets: vi.fn(),
      listCategories: vi.fn(),
    };

    await runTopUpsCommand({
      env: {
        ynabAccessToken: "token",
        rulesFile: "default-rules.json",
        auditLogFile: "audit.jsonl",
      },
      options: { apply: false, budget: "missing-budget" },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(twoBudgetConfigFixture()),
        createBudgetClient: () => budgetClient,
        createAuditLog: () => new MemoryAuditLog(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(budgetClient.listCategories).not.toHaveBeenCalled();
    expect(budgetClient.getCategoryMonth).not.toHaveBeenCalled();
    expect(budgetClient.updateCategoryBudgeted).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Summary:\n  rules considered: 0"));
  });

  it("requires --only to match the requested --budget when both filters are provided", async () => {
    await expect(
      runTopUpsCommand({
        env: {
          ynabAccessToken: "token",
          rulesFile: "default-rules.json",
          auditLogFile: "audit.jsonl",
        },
        options: { apply: false, only: "rule-1", budget: "budget-2" },
        dependencies: {
          loadRulesConfig: vi.fn().mockResolvedValue(twoBudgetConfigFixture()),
          createBudgetClient: vi.fn<() => BudgetClient>(),
          createAuditLog: vi.fn<() => MemoryAuditLog>(),
          currentBudgetMonth: () => parseBudgetMonth("2026-08"),
        },
      }),
    ).rejects.toThrow("Rule not found for budget budget-2: rule-1");
  });

  it("fails before creating YNAB dependencies when --only does not match a rule", async () => {
    const createBudgetClient = vi.fn<() => BudgetClient>();
    const createAuditLog = vi.fn<() => MemoryAuditLog>();

    await expect(
      runTopUpsCommand({
        env: {
          ynabAccessToken: "token",
          rulesFile: "default-rules.json",
          auditLogFile: "audit.jsonl",
        },
        options: { apply: false, only: "missing-rule" },
        dependencies: {
          loadRulesConfig: vi.fn().mockResolvedValue(configFixture()),
          createBudgetClient,
          createAuditLog,
          currentBudgetMonth: () => parseBudgetMonth("2026-08"),
        },
      }),
    ).rejects.toThrow("Rule not found: missing-rule");

    expect(createBudgetClient).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
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

function twoRuleConfigFixture() {
  return {
    rules: [
      ...configFixture().rules,
      {
        id: "rule-2",
        type: "monthly-category-top-up" as const,
        enabled: true,
        budgetId: "budget-1",
        categoryId: "category-2",
        monthlyAmount: milliunits(30_000),
        targetBalance: milliunits(100_000),
      },
    ],
  };
}

function disabledOnlyConfigFixture() {
  return {
    rules: [
      {
        id: "disabled-rule",
        type: "monthly-category-top-up" as const,
        enabled: false,
        budgetId: "budget-1",
        categoryId: "category-1",
        monthlyAmount: milliunits(50_000),
        targetBalance: milliunits(200_000),
      },
    ],
  };
}

function twoBudgetConfigFixture() {
  return {
    rules: [
      ...configFixture().rules,
      {
        id: "budget-2-rule",
        type: "monthly-category-top-up" as const,
        enabled: true,
        budgetId: "budget-2",
        categoryId: "category-2",
        monthlyAmount: milliunits(30_000),
        targetBalance: milliunits(100_000),
      },
    ],
  };
}
