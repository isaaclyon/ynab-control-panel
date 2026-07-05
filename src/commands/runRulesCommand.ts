import { JsonlBudgetOperationAuditLog, type BudgetOperationAuditLog } from "../audit/auditLog.js";
import type { AppEnv } from "../config/env.js";
import { loadRulesConfig, type RulesConfig } from "../config/rules.js";
import { currentBudgetMonth, parseBudgetMonth, type BudgetMonth } from "../domain/month.js";
import {
  formatBudgetRuleRunResults,
  formatBudgetRuleRunResultsJson,
  runBudgetRules,
  type CategoryNameLookup,
} from "../jobs/runBudgetRules.js";
import type { BudgetClient, YnabCatalogClient } from "../ynab/budgetClient.js";
import { YnabBudgetClient } from "../ynab/ynabBudgetClient.js";

export type RunRulesOptions = {
  readonly month?: string;
  readonly apply: boolean;
  readonly rules?: string;
  readonly json?: boolean;
  readonly only?: string;
  readonly budget?: string;
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
  const runConfig = filterRulesConfig(config, {
    ...(input.options.only ? { only: input.options.only } : {}),
    ...(input.options.budget ? { budget: input.options.budget } : {}),
  });
  const budgetClient = dependencies.createBudgetClient(input.env.ynabAccessToken);
  const categoryNameLookup = await loadCategoryNameLookup({ config: runConfig, budgetClient });
  const auditLog = dependencies.createAuditLog(input.env.auditLogFile);
  const results = await runBudgetRules({
    config: runConfig,
    month,
    dryRun: !input.options.apply,
    budgetClient,
    auditLog,
    ...(categoryNameLookup ? { categoryNameLookup } : {}),
  });

  const format = input.options.json ? formatBudgetRuleRunResultsJson : formatBudgetRuleRunResults;
  (input.stdout ?? process.stdout).write(`${format(results, { totalRulesConsidered: runConfig.rules.length })}\n`);
}

function parseRequestedMonth(month: string | undefined, getCurrentBudgetMonth: () => BudgetMonth): BudgetMonth {
  return month ? parseBudgetMonth(month) : getCurrentBudgetMonth();
}

function filterRulesConfig(
  config: RulesConfig,
  filters: { readonly only?: string; readonly budget?: string },
): RulesConfig {
  if (filters.only) {
    const rule = config.rules.find((candidate) => candidate.id === filters.only);
    if (!rule) {
      throw new Error(`Rule not found: ${filters.only}`);
    }

    if (filters.budget && rule.budgetId !== filters.budget) {
      throw new Error(`Rule not found for budget ${filters.budget}: ${filters.only}`);
    }

    return { rules: [rule] };
  }

  if (filters.budget) {
    return { rules: config.rules.filter((rule) => rule.budgetId === filters.budget) };
  }

  return config;
}

async function loadCategoryNameLookup(input: {
  readonly config: RulesConfig;
  readonly budgetClient: BudgetClient;
}): Promise<CategoryNameLookup | undefined> {
  if (!canListCategories(input.budgetClient)) {
    return undefined;
  }

  const catalogClient = input.budgetClient;
  const budgetIds = [...new Set(input.config.rules.filter((rule) => rule.enabled).map((rule) => rule.budgetId))];
  const categoriesByBudget = await Promise.all(
    budgetIds.map(async (budgetId) => {
      try {
        return {
          budgetId,
          categories: await catalogClient.listCategories({ budgetId }),
        };
      } catch {
        return { budgetId, categories: [] };
      }
    }),
  );
  const categoryNames = new Map<string, string>();

  for (const budget of categoriesByBudget) {
    for (const category of budget.categories) {
      categoryNames.set(categoryKey({ budgetId: budget.budgetId, categoryId: category.id }), category.name);
    }
  }

  return ({ budgetId, categoryId }) => categoryNames.get(categoryKey({ budgetId, categoryId }));
}

function canListCategories(client: BudgetClient): client is BudgetClient & YnabCatalogClient {
  return typeof (client as { readonly listCategories?: unknown }).listCategories === "function";
}

function categoryKey(input: { readonly budgetId: string; readonly categoryId: string }): string {
  return `${input.budgetId}\u0000${input.categoryId}`;
}
