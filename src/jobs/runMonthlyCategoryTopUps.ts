import type { TopUpAuditLog } from "../audit/auditLog.js";
import type { RulesConfig } from "../config/rules.js";
import type { BudgetMonth } from "../domain/month.js";
import type { BudgetClient } from "../ynab/budgetClient.js";
import {
  formatBudgetRuleRunResults,
  runBudgetRules,
  type BudgetRuleRunResult,
  type CategoryNameLookup,
} from "./runBudgetRules.js";

export type TopUpRunResult = BudgetRuleRunResult;

export async function runMonthlyCategoryTopUps(input: {
  readonly config: RulesConfig;
  readonly month: BudgetMonth;
  readonly dryRun: boolean;
  readonly budgetClient: BudgetClient;
  readonly auditLog: TopUpAuditLog;
  readonly categoryNameLookup?: CategoryNameLookup;
  readonly now?: Date;
}): Promise<readonly TopUpRunResult[]> {
  return runBudgetRules(input);
}

export function formatTopUpRunResults(
  results: readonly TopUpRunResult[],
  options: { readonly totalRulesConsidered?: number } = {},
): string {
  return formatBudgetRuleRunResults(results, options);
}
