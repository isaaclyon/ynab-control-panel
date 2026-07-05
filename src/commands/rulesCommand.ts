import { loadRulesConfig, type RulesConfig } from "../config/rules.js";
import type { RulesEnv } from "../config/env.js";
import type { BudgetRule } from "../domain/budgetRule.js";
import type { AmountPolicy } from "../domain/categoryAvailableTransfer.js";
import { formatMilliunits } from "../domain/money.js";

export type RulesCommandOptions = {
  readonly rules?: string;
};

type RulesCommandDependencies = {
  readonly loadRulesConfig: (path: string) => Promise<RulesConfig>;
};

const defaultDependencies: RulesCommandDependencies = {
  loadRulesConfig,
};

export async function rulesValidateCommand(input: {
  readonly env: RulesEnv;
  readonly options: RulesCommandOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<RulesCommandDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const rulesPath = resolveRulesPath(input.env, input.options);
  const config = await dependencies.loadRulesConfig(rulesPath);

  (input.stdout ?? process.stdout).write(`${formatRulesValidation(rulesPath, config)}\n`);
}

export async function rulesListCommand(input: {
  readonly env: RulesEnv;
  readonly options: RulesCommandOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<RulesCommandDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const rulesPath = resolveRulesPath(input.env, input.options);
  const config = await dependencies.loadRulesConfig(rulesPath);

  (input.stdout ?? process.stdout).write(`${formatRulesList(rulesPath, config)}\n`);
}

export async function rulesExplainCommand(input: {
  readonly env: RulesEnv;
  readonly options: RulesCommandOptions & { readonly ruleId: string };
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<RulesCommandDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const rulesPath = resolveRulesPath(input.env, input.options);
  const config = await dependencies.loadRulesConfig(rulesPath);
  const rule = config.rules.find((candidate) => candidate.id === input.options.ruleId);
  if (!rule) {
    throw new Error(`Rule not found: ${input.options.ruleId}`);
  }

  (input.stdout ?? process.stdout).write(`${formatRuleExplanation(rule)}\n`);
}

export function formatRulesValidation(path: string, config: RulesConfig): string {
  const enabledCount = config.rules.filter((rule) => rule.enabled).length;
  const disabledCount = config.rules.length - enabledCount;

  return [
    `Rules config valid: ${path}`,
    `  rules: ${config.rules.length}`,
    `  enabled: ${enabledCount}`,
    `  disabled: ${disabledCount}`,
    "No YNAB calls were performed.",
  ].join("\n");
}

export function formatRulesList(path: string, config: RulesConfig): string {
  return [
    `Rules in ${path}:`,
    "ruleId\ttype\tenabled\tbudgetId\tcategories",
    ...config.rules.map(
      (rule) =>
        `${sanitizeCell(rule.id)}\t${rule.type}\t${rule.enabled ? "yes" : "no"}\t${sanitizeCell(rule.budgetId)}\t${sanitizeCell(formatRuleCategories(rule))}`,
    ),
    "No YNAB calls were performed.",
  ].join("\n");
}

export function formatRuleExplanation(rule: BudgetRule): string {
  const commonLines = [
    `ruleId: ${rule.id}`,
    `type: ${rule.type}`,
    `enabled: ${rule.enabled ? "yes" : "no"}`,
    `budgetId: ${rule.budgetId}`,
  ];

  switch (rule.type) {
    case "monthly-category-top-up":
      return [
        ...commonLines,
        `categoryId: ${rule.categoryId}`,
        `monthlyAmount: ${formatMilliunits(rule.monthlyAmount)}`,
        `targetBalance: ${formatMilliunits(rule.targetBalance)}`,
        `effect: assigns up to ${formatMilliunits(rule.monthlyAmount)} to ${rule.categoryId} until available balance reaches ${formatMilliunits(rule.targetBalance)}`,
        "No YNAB calls were performed.",
      ].join("\n");
    case "category-available-transfer":
      return [
        ...commonLines,
        `fromCategoryId: ${rule.fromCategoryId}`,
        `toCategoryId: ${rule.toCategoryId}`,
        `amount: ${formatAmountPolicy(rule.amount)}`,
        `leaveAvailable: ${formatMilliunits(rule.leaveAvailable)}`,
        `effect: moves ${formatAmountPolicy(rule.amount)} from ${rule.fromCategoryId} to ${rule.toCategoryId} after leaving at least ${formatMilliunits(rule.leaveAvailable)} available in the source category`,
        "No YNAB calls were performed.",
      ].join("\n");
  }
}

function resolveRulesPath(env: RulesEnv, options: RulesCommandOptions): string {
  return options.rules ?? env.rulesFile;
}

function formatRuleCategories(rule: BudgetRule): string {
  switch (rule.type) {
    case "monthly-category-top-up":
      return rule.categoryId;
    case "category-available-transfer":
      return `${rule.fromCategoryId} -> ${rule.toCategoryId}`;
  }
}

function formatAmountPolicy(policy: AmountPolicy): string {
  switch (policy.type) {
    case "fixed":
      return formatMilliunits(policy.amount);
    case "percent-of-available":
      return policy.max === undefined
        ? `${policy.percent}% of available`
        : `${policy.percent}% of available, capped at ${formatMilliunits(policy.max)}`;
  }
}

function sanitizeCell(value: string): string {
  return value.replace(/[\t\n\r]+/g, " ");
}
