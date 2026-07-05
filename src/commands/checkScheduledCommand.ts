import { open, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { AppEnv } from "../config/env.js";
import { parseEnv } from "../config/env.js";
import { loadRulesConfig, type RulesConfig } from "../config/rules.js";
import type { BudgetRule } from "../domain/budgetRule.js";
import { currentBudgetMonth, parseBudgetMonth, type BudgetMonth } from "../domain/month.js";
import type { BudgetClient, YnabCatalogClient } from "../ynab/budgetClient.js";
import { YnabBudgetClient } from "../ynab/ynabBudgetClient.js";

export type CheckScheduledOptions = {
  readonly month?: string;
  readonly rules?: string;
};

export type HealthCheckStatus = "pass" | "fail" | "skip";

export type HealthCheckResult = {
  readonly status: HealthCheckStatus;
  readonly name: string;
  readonly message: string;
};

export type ScheduledHealthCheckReport = {
  readonly checks: readonly HealthCheckResult[];
};

type ScheduledHealthCheckClient = Pick<BudgetClient, "getCategoryMonth"> & Pick<YnabCatalogClient, "listBudgets">;

type CheckScheduledDependencies = {
  readonly parseEnv: (env: NodeJS.ProcessEnv) => AppEnv;
  readonly loadRulesConfig: (path: string) => Promise<RulesConfig>;
  readonly createHealthCheckClient: (accessToken: string) => ScheduledHealthCheckClient;
  readonly assertAuditLogPathWritable: (path: string) => Promise<void>;
  readonly currentBudgetMonth: () => BudgetMonth;
};

const defaultDependencies: CheckScheduledDependencies = {
  parseEnv,
  loadRulesConfig,
  createHealthCheckClient: (accessToken) => new YnabBudgetClient(accessToken),
  assertAuditLogPathWritable,
  currentBudgetMonth,
};

export async function checkScheduledCommand(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly options: CheckScheduledOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<CheckScheduledDependencies>;
}): Promise<ScheduledHealthCheckReport> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const report = await runScheduledHealthCheck({ env: input.env, options: input.options, dependencies });
  (input.stdout ?? process.stdout).write(`${formatScheduledHealthCheckReport(report)}\n`);
  return report;
}

export async function runScheduledHealthCheck(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly options: CheckScheduledOptions;
  readonly dependencies?: Partial<CheckScheduledDependencies>;
}): Promise<ScheduledHealthCheckReport> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const checks: HealthCheckResult[] = [];
  const parsedMonth = parseRequestedMonth(input.options.month, dependencies.currentBudgetMonth);

  if (!parsedMonth.ok) {
    checks.push({ status: "fail", name: "month", message: parsedMonth.message });
    checks.push({ status: "skip", name: "rules", message: "skipped because month parsing failed" });
    checks.push({ status: "skip", name: "audit-log", message: "skipped because month parsing failed" });
    checks.push({ status: "skip", name: "ynab", message: "skipped because month parsing failed" });
    checks.push({ status: "skip", name: "configured-categories", message: "skipped because month parsing failed" });
    return { checks };
  }

  const parsedEnv = parseAppEnv(input.env, dependencies.parseEnv);
  if (!parsedEnv.ok) {
    checks.push({ status: "fail", name: "env", message: parsedEnv.message });
    checks.push({ status: "skip", name: "rules", message: "skipped because environment parsing failed" });
    checks.push({ status: "skip", name: "audit-log", message: "skipped because environment parsing failed" });
    checks.push({ status: "skip", name: "ynab", message: "skipped because environment parsing failed" });
    checks.push({
      status: "skip",
      name: "configured-categories",
      message: "skipped because environment parsing failed",
    });
    return { checks };
  }

  checks.push({ status: "pass", name: "env", message: "YNAB environment parsed" });

  const rulesPath = input.options.rules ?? parsedEnv.env.rulesFile;
  const loadedRules = await loadRules(rulesPath, dependencies.loadRulesConfig);
  if (loadedRules.ok) {
    checks.push({
      status: "pass",
      name: "rules",
      message: `loaded ${loadedRules.config.rules.length} rule(s) from ${rulesPath}`,
    });
  } else {
    checks.push({ status: "fail", name: "rules", message: loadedRules.message });
  }

  const auditLogWritable = await checkAuditLogPath(parsedEnv.env.auditLogFile, dependencies.assertAuditLogPathWritable);
  checks.push(
    auditLogWritable.ok
      ? { status: "pass", name: "audit-log", message: `path is writable: ${parsedEnv.env.auditLogFile}` }
      : { status: "fail", name: "audit-log", message: auditLogWritable.message },
  );

  const client = dependencies.createHealthCheckClient(parsedEnv.env.ynabAccessToken);
  const ynabConnectivity = await checkYnabConnectivity(client);
  checks.push(
    ynabConnectivity.ok
      ? { status: "pass", name: "ynab", message: `connected; found ${ynabConnectivity.budgetCount} budget(s)` }
      : { status: "fail", name: "ynab", message: ynabConnectivity.message },
  );

  if (!loadedRules.ok || !ynabConnectivity.ok) {
    checks.push({
      status: "skip",
      name: "configured-categories",
      message: "skipped because rules parsing or YNAB connectivity failed",
    });
    return { checks };
  }

  const categoryReads = await checkConfiguredCategories({
    config: loadedRules.config,
    month: parsedMonth.month,
    client,
  });
  checks.push(
    categoryReads.ok
      ? {
          status: "pass",
          name: "configured-categories",
          message: `read ${categoryReads.categoryCount} configured category snapshot(s) for ${parsedMonth.month}`,
        }
      : { status: "fail", name: "configured-categories", message: categoryReads.message },
  );

  return { checks };
}

export function formatScheduledHealthCheckReport(report: ScheduledHealthCheckReport): string {
  const lines = ["Scheduled-run health check"];

  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase()}: ${check.name}: ${check.message}`);
  }

  lines.push(
    healthCheckPassed(report)
      ? "OK: scheduled run health check passed. No YNAB mutations were performed."
      : "FAILED: scheduled run health check failed. No YNAB mutations were performed.",
  );

  return lines.join("\n");
}

export function healthCheckPassed(report: ScheduledHealthCheckReport): boolean {
  return report.checks.every((check) => check.status === "pass");
}

async function assertAuditLogPathWritable(path: string): Promise<void> {
  try {
    const existingPath = await stat(path);
    if (existingPath.isDirectory()) {
      throw new Error(`Audit log path points to a directory: ${path}`);
    }

    const file = await open(path, "a");
    await file.close();
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const directory = dirname(path);
  const existingDirectory = await stat(directory);
  if (!existingDirectory.isDirectory()) {
    throw new Error(`Audit log parent path is not a directory: ${directory}`);
  }

  const probePath = join(directory, `.${basename(path)}.healthcheck-${process.pid}-${Date.now()}.tmp`);

  try {
    await writeFile(probePath, "", { encoding: "utf8", flag: "wx" });
  } finally {
    await rm(probePath, { force: true });
  }
}

function parseRequestedMonth(
  month: string | undefined,
  getCurrentBudgetMonth: () => BudgetMonth,
): { readonly ok: true; readonly month: BudgetMonth } | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, month: month ? parseBudgetMonth(month) : getCurrentBudgetMonth() };
  } catch (error) {
    return { ok: false, message: `invalid month: ${errorMessage(error)}` };
  }
}

function parseAppEnv(
  env: NodeJS.ProcessEnv,
  parse: (env: NodeJS.ProcessEnv) => AppEnv,
): { readonly ok: true; readonly env: AppEnv } | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, env: parse(env) };
  } catch (error) {
    return { ok: false, message: `invalid environment: ${errorMessage(error)}` };
  }
}

async function loadRules(
  path: string,
  load: (path: string) => Promise<RulesConfig>,
): Promise<{ readonly ok: true; readonly config: RulesConfig } | { readonly ok: false; readonly message: string }> {
  try {
    return { ok: true, config: await load(path) };
  } catch (error) {
    return { ok: false, message: `rules file check failed for ${path}: ${errorMessage(error)}` };
  }
}

async function checkAuditLogPath(
  path: string,
  assertWritable: (path: string) => Promise<void>,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  try {
    await assertWritable(path);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `audit log path is not writable (${path}): ${errorMessage(error)}` };
  }
}

async function checkYnabConnectivity(
  client: Pick<YnabCatalogClient, "listBudgets">,
): Promise<{ readonly ok: true; readonly budgetCount: number } | { readonly ok: false; readonly message: string }> {
  try {
    const budgets = await client.listBudgets();
    return { ok: true, budgetCount: budgets.length };
  } catch (error) {
    return { ok: false, message: `YNAB connectivity failed: ${errorMessage(error)}` };
  }
}

async function checkConfiguredCategories(input: {
  readonly config: RulesConfig;
  readonly month: BudgetMonth;
  readonly client: Pick<BudgetClient, "getCategoryMonth">;
}): Promise<{ readonly ok: true; readonly categoryCount: number } | { readonly ok: false; readonly message: string }> {
  const categoryRefs = enabledRuleCategoryRefs(input.config.rules);

  for (const ref of categoryRefs) {
    try {
      await input.client.getCategoryMonth({ budgetId: ref.budgetId, month: input.month, categoryId: ref.categoryId });
    } catch (error) {
      return {
        ok: false,
        message: `configured category read failed for budget ${ref.budgetId}, category ${ref.categoryId}: ${errorMessage(error)}`,
      };
    }
  }

  return { ok: true, categoryCount: categoryRefs.length };
}

function enabledRuleCategoryRefs(
  rules: readonly BudgetRule[],
): readonly { readonly budgetId: string; readonly categoryId: string }[] {
  const refs = new Map<string, { readonly budgetId: string; readonly categoryId: string }>();

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    for (const categoryId of ruleCategoryIds(rule)) {
      const key = `${rule.budgetId}\u0000${categoryId}`;
      refs.set(key, { budgetId: rule.budgetId, categoryId });
    }
  }

  return [...refs.values()];
}

function ruleCategoryIds(rule: BudgetRule): readonly string[] {
  switch (rule.type) {
    case "monthly-category-top-up":
      return [rule.categoryId];
    case "category-available-transfer":
      return [rule.fromCategoryId, rule.toCategoryId];
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
