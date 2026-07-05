import { JsonlTopUpAuditLog, type TopUpAuditLog } from "../audit/auditLog.js";
import { loadRulesConfig, type RulesConfig } from "../config/rules.js";
import type { AppEnv } from "../config/env.js";
import { currentBudgetMonth, parseBudgetMonth, type BudgetMonth } from "../domain/month.js";
import { formatTopUpRunResults, runMonthlyCategoryTopUps } from "../jobs/runMonthlyCategoryTopUps.js";
import type { BudgetClient } from "../ynab/budgetClient.js";
import { YnabBudgetClient } from "../ynab/ynabBudgetClient.js";

export type RunTopUpsOptions = {
  readonly month?: string;
  readonly apply: boolean;
  readonly rules?: string;
};

type RunTopUpsDependencies = {
  readonly loadRulesConfig: (path: string) => Promise<RulesConfig>;
  readonly createBudgetClient: (accessToken: string) => BudgetClient;
  readonly createAuditLog: (path: string) => TopUpAuditLog;
  readonly currentBudgetMonth: () => BudgetMonth;
};

const defaultDependencies: RunTopUpsDependencies = {
  loadRulesConfig,
  createBudgetClient: (accessToken) => new YnabBudgetClient(accessToken),
  createAuditLog: (path) => new JsonlTopUpAuditLog(path),
  currentBudgetMonth,
};

export async function runTopUpsCommand(input: {
  readonly env: AppEnv;
  readonly options: RunTopUpsOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<RunTopUpsDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const month = parseRequestedMonth(input.options.month, dependencies.currentBudgetMonth);
  const config = await dependencies.loadRulesConfig(input.options.rules ?? input.env.rulesFile);
  const budgetClient = dependencies.createBudgetClient(input.env.ynabAccessToken);
  const auditLog = dependencies.createAuditLog(input.env.auditLogFile);
  const results = await runMonthlyCategoryTopUps({
    config,
    month,
    dryRun: !input.options.apply,
    budgetClient,
    auditLog,
  });

  (input.stdout ?? process.stdout).write(`${formatTopUpRunResults(results)}\n`);
}

function parseRequestedMonth(month: string | undefined, getCurrentBudgetMonth: () => BudgetMonth): BudgetMonth {
  return month ? parseBudgetMonth(month) : getCurrentBudgetMonth();
}
