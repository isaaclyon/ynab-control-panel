import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  checkScheduledCommand,
  formatScheduledHealthCheckReport,
  healthCheckPassed,
  runScheduledHealthCheck,
} from "../../src/commands/checkScheduledCommand.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import type { BudgetClient, YnabCatalogClient } from "../../src/ynab/budgetClient.js";

type HealthCheckClient = Pick<BudgetClient, "getCategoryMonth"> & Pick<YnabCatalogClient, "listBudgets">;

describe("scheduled-run health check command", () => {
  it("verifies env, rules, audit path, YNAB connectivity, and configured category reads without mutation methods", async () => {
    const write = vi.fn();
    const getCategoryMonth = vi.fn<HealthCheckClient["getCategoryMonth"]>().mockResolvedValue({
      budgeted: milliunits(0),
      activity: milliunits(0),
      balance: milliunits(0),
    });
    const client: HealthCheckClient = {
      listBudgets: vi
        .fn<HealthCheckClient["listBudgets"]>()
        .mockResolvedValue([{ id: "budget-1", name: "Main", isDefault: true }]),
      getCategoryMonth,
    };
    const assertAuditLogPathWritable = vi.fn().mockResolvedValue(undefined);

    const report = await checkScheduledCommand({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "default-rules.json", YNAB_AUDIT_LOG_FILE: "audit.jsonl" },
      options: { month: "2026-07", rules: "custom-rules.json" },
      stdout: { write },
      dependencies: {
        loadRulesConfig: vi.fn().mockResolvedValue(configFixture()),
        createHealthCheckClient: vi.fn().mockReturnValue(client),
        assertAuditLogPathWritable,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(true);
    expect(assertAuditLogPathWritable).toHaveBeenCalledWith("audit.jsonl");
    expect(client.listBudgets).toHaveBeenCalledOnce();
    expect(getCategoryMonth).toHaveBeenCalledTimes(3);
    expect(getCategoryMonth).toHaveBeenCalledWith({ budgetId: "budget-1", month: "2026-07", categoryId: "top-up" });
    expect(getCategoryMonth).toHaveBeenCalledWith({ budgetId: "budget-1", month: "2026-07", categoryId: "from" });
    expect(getCategoryMonth).toHaveBeenCalledWith({ budgetId: "budget-1", month: "2026-07", categoryId: "to" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("OK: scheduled run health check passed"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("No YNAB mutations were performed"));
  });

  it("uses the configured rules file and current budget month by default", async () => {
    const loadRulesConfig = vi.fn().mockResolvedValue(configFixture());
    const getCategoryMonth = vi.fn<HealthCheckClient["getCategoryMonth"]>().mockResolvedValue({
      budgeted: milliunits(0),
      activity: milliunits(0),
      balance: milliunits(0),
    });

    await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "default-rules.json", YNAB_AUDIT_LOG_FILE: "audit.jsonl" },
      options: {},
      dependencies: {
        loadRulesConfig,
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth,
        }),
        assertAuditLogPathWritable: async () => undefined,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(loadRulesConfig).toHaveBeenCalledWith("default-rules.json");
    expect(getCategoryMonth).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-08" }));
  });

  it("reports env failures and skips dependent checks", async () => {
    const report = await runScheduledHealthCheck({
      env: {},
      options: {},
      dependencies: {
        parseEnv: () => {
          throw new Error("missing token");
        },
        loadRulesConfig: vi.fn(),
        createHealthCheckClient: vi.fn(),
        assertAuditLogPathWritable: vi.fn(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(false);
    expect(report.checks).toEqual([
      { status: "fail", name: "env", message: "invalid environment: missing token" },
      { status: "skip", name: "rules", message: "skipped because environment parsing failed" },
      { status: "skip", name: "audit-log", message: "skipped because environment parsing failed" },
      { status: "skip", name: "ynab", message: "skipped because environment parsing failed" },
      { status: "skip", name: "configured-categories", message: "skipped because environment parsing failed" },
    ]);
  });

  it("reports invalid month failures before touching scheduled-run dependencies", async () => {
    const loadRulesConfig = vi.fn();
    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: "audit.jsonl" },
      options: { month: "not-a-month" },
      dependencies: {
        loadRulesConfig,
        createHealthCheckClient: vi.fn(),
        assertAuditLogPathWritable: vi.fn(),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(false);
    expect(loadRulesConfig).not.toHaveBeenCalled();
    expect(report.checks[0]).toEqual({
      status: "fail",
      name: "month",
      message: "invalid month: Budget month must use YYYY-MM, received not-a-month",
    });
  });

  it("keeps checking non-dependent scheduled-run requirements after a rules failure", async () => {
    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "missing.json", YNAB_AUDIT_LOG_FILE: "audit.jsonl" },
      options: {},
      dependencies: {
        loadRulesConfig: async () => {
          throw new Error("ENOENT");
        },
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth: vi.fn(),
        }),
        assertAuditLogPathWritable: async () => undefined,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(report.checks.map((check) => [check.name, check.status])).toEqual([
      ["env", "pass"],
      ["rules", "fail"],
      ["audit-log", "pass"],
      ["ynab", "pass"],
      ["configured-categories", "skip"],
    ]);
    expect(formatScheduledHealthCheckReport(report)).toContain("FAILED: scheduled run health check failed");
  });

  it("checks audit log writability with a real filesystem probe without creating the audit log", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ynab-health-check-test-"));
    const auditLogFile = join(directory, "audit.jsonl");

    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: auditLogFile },
      options: {},
      dependencies: {
        loadRulesConfig: async () => configFixture(),
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth: async () => ({ budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) }),
        }),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(true);
    expect(report.checks).toContainEqual({
      status: "pass",
      name: "audit-log",
      message: `path is writable: ${auditLogFile}`,
    });
    await expect(stat(auditLogFile)).rejects.toThrow();
  });

  it("checks append access without modifying an existing audit log file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ynab-health-existing-audit-"));
    const auditLogFile = join(directory, "audit.jsonl");
    await writeFile(auditLogFile, "existing\n", "utf8");

    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: auditLogFile },
      options: {},
      dependencies: {
        loadRulesConfig: async () => configFixture(),
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth: async () => ({ budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) }),
        }),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(true);
    await expect(readFile(auditLogFile, "utf8")).resolves.toBe("existing\n");
  });

  it("fails audit log writability when an existing audit log file cannot be opened for append", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ynab-health-readonly-audit-"));
    const auditLogFile = join(directory, "audit.jsonl");
    await writeFile(auditLogFile, "existing\n", "utf8");
    await chmod(auditLogFile, 0o444);

    try {
      const report = await runScheduledHealthCheck({
        env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: auditLogFile },
        options: {},
        dependencies: {
          loadRulesConfig: async () => configFixture(),
          createHealthCheckClient: () => ({
            listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
            getCategoryMonth: async () => ({
              budgeted: milliunits(0),
              activity: milliunits(0),
              balance: milliunits(0),
            }),
          }),
          currentBudgetMonth: () => parseBudgetMonth("2026-08"),
        },
      });

      expect(healthCheckPassed(report)).toBe(false);
      expect(report.checks.find((check) => check.name === "audit-log")).toMatchObject({
        status: "fail",
        name: "audit-log",
      });
    } finally {
      await chmod(auditLogFile, 0o644);
    }
  });

  it("fails audit log writability without creating a missing parent directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ynab-health-missing-parent-"));
    const missingParent = join(directory, "missing");
    const auditLogFile = join(missingParent, "audit.jsonl");

    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: auditLogFile },
      options: {},
      dependencies: {
        loadRulesConfig: async () => configFixture(),
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth: async () => ({ budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) }),
        }),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(false);
    expect(report.checks.find((check) => check.name === "audit-log")).toMatchObject({
      status: "fail",
      name: "audit-log",
    });
    await expect(stat(missingParent)).rejects.toThrow();
  });

  it("fails audit log writability when the configured path is a directory", async () => {
    const auditLogDirectory = await mkdtemp(join(tmpdir(), "ynab-health-check-audit-dir-"));

    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: auditLogDirectory },
      options: {},
      dependencies: {
        loadRulesConfig: async () => configFixture(),
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth: async () => ({ budgeted: milliunits(0), activity: milliunits(0), balance: milliunits(0) }),
        }),
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(false);
    expect(report.checks).toContainEqual({
      status: "fail",
      name: "audit-log",
      message: `audit log path is not writable (${auditLogDirectory}): Audit log path points to a directory: ${auditLogDirectory}`,
    });
  });

  it("reports YNAB connectivity failures and skips configured category reads", async () => {
    const getCategoryMonth = vi.fn<HealthCheckClient["getCategoryMonth"]>();
    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: "audit.jsonl" },
      options: {},
      dependencies: {
        loadRulesConfig: async () => configFixture(),
        createHealthCheckClient: () => ({
          listBudgets: async () => {
            throw "network down";
          },
          getCategoryMonth,
        }),
        assertAuditLogPathWritable: async () => undefined,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(false);
    expect(getCategoryMonth).not.toHaveBeenCalled();
    expect(report.checks).toContainEqual({
      status: "fail",
      name: "ynab",
      message: "YNAB connectivity failed: network down",
    });
    expect(report.checks.at(-1)).toEqual({
      status: "skip",
      name: "configured-categories",
      message: "skipped because rules parsing or YNAB connectivity failed",
    });
  });

  it("fails if an enabled rule's configured category cannot be read", async () => {
    const report = await runScheduledHealthCheck({
      env: { YNAB_ACCESS_TOKEN: "token", YNAB_RULES_FILE: "rules.json", YNAB_AUDIT_LOG_FILE: "audit.jsonl" },
      options: {},
      dependencies: {
        loadRulesConfig: async () => configFixture(),
        createHealthCheckClient: () => ({
          listBudgets: async () => [{ id: "budget-1", name: "Main", isDefault: true }],
          getCategoryMonth: async () => {
            throw new Error("category not found");
          },
        }),
        assertAuditLogPathWritable: async () => undefined,
        currentBudgetMonth: () => parseBudgetMonth("2026-08"),
      },
    });

    expect(healthCheckPassed(report)).toBe(false);
    expect(report.checks.at(-1)).toEqual({
      status: "fail",
      name: "configured-categories",
      message: "configured category read failed for budget budget-1, category top-up: category not found",
    });
  });
});

function configFixture() {
  return {
    rules: [
      {
        id: "top-up-rule",
        type: "monthly-category-top-up" as const,
        enabled: true,
        budgetId: "budget-1",
        categoryId: "top-up",
        monthlyAmount: milliunits(50_000),
        targetBalance: milliunits(200_000),
      },
      {
        id: "transfer-rule",
        type: "category-available-transfer" as const,
        enabled: true,
        budgetId: "budget-1",
        fromCategoryId: "from",
        toCategoryId: "to",
        amount: { type: "fixed" as const, amount: milliunits(10_000) },
        leaveAvailable: milliunits(0),
      },
      {
        id: "disabled-rule",
        type: "monthly-category-top-up" as const,
        enabled: false,
        budgetId: "budget-1",
        categoryId: "disabled",
        monthlyAmount: milliunits(50_000),
        targetBalance: milliunits(200_000),
      },
    ],
  };
}
