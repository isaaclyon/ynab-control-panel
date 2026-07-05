import { JsonlBudgetOperationAuditLog, type BudgetOperationAuditLog } from "../audit/auditLog.js";
import type { AppEnv } from "../config/env.js";
import { loadRulesConfig, type RulesConfig } from "../config/rules.js";
import { currentBudgetMonth, parseBudgetMonth, type BudgetMonth } from "../domain/month.js";
import { formatBudgetRuleRunResults, runBudgetRules } from "../jobs/runBudgetRules.js";
import type { BudgetClient } from "../ynab/budgetClient.js";
import { YnabBudgetClient } from "../ynab/ynabBudgetClient.js";

export type RunRulesOptions = {
  readonly month?: string;
  readonly apply: boolean;
  readonly rules?: string;
};

type RunRulesDependencies = {
  readonly loadRulesConfig: (path: string) => Promise<RulesConfig>;
  readonly createBudgetClient: (accessToken: string) => BudgetClient;
  readonly createAuditLog: (path: string) => BudgetOperationAuditLog;
  readonly currentBudgetMonth: () => BudgetMonth;
};

const defaultDependencies: RunRulesDependencies = {
  loadRulesConfig,
  createBudgetClient: (accessToken) => new YnabBudgetClient(accessToken),
  createAuditLog: (path) => new JsonlBudgetOperationAuditLog(path),
  currentBudgetMonth,
};

export async function runRulesCommand(input: {
  readonly env: AppEnv;
  readonly options: RunRulesOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<RunRulesDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const month = parseRequestedMonth(input.options.month, dependencies.currentBudgetMonth);
  const config = await dependencies.loadRulesConfig(input.options.rules ?? input.env.rulesFile);
  const budgetClient = dependencies.createBudgetClient(input.env.ynabAccessToken);
  const auditLog = dependencies.createAuditLog(input.env.auditLogFile);
  const results = await runBudgetRules({
    config,
    month,
    dryRun: !input.options.apply,
    budgetClient,
    auditLog,
  });

  (input.stdout ?? process.stdout).write(`${formatBudgetRuleRunResults(results)}\n`);
}

function parseRequestedMonth(month: string | undefined, getCurrentBudgetMonth: () => BudgetMonth): BudgetMonth {
  return month ? parseBudgetMonth(month) : getCurrentBudgetMonth();
}
