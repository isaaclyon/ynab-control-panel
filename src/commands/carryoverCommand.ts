import type { AppEnv } from "../config/env.js";
import {
  formatCarryoverPlan,
  formatCarryoverPlanJson,
  planCarryover,
  type CarryoverCategorySnapshot,
} from "../domain/carryover.js";
import { nextBudgetMonth, parseBudgetMonth, type BudgetMonth } from "../domain/month.js";
import type { BudgetClient, YnabCatalogClient } from "../ynab/budgetClient.js";
import { YnabBudgetClient } from "../ynab/ynabBudgetClient.js";

export type CarryoverPlanOptions = {
  readonly budget: string;
  readonly month: string;
  readonly sources: string;
  readonly json?: boolean;
};

type CarryoverPlanClient = Pick<BudgetClient, "getCategoryMonth"> & Pick<YnabCatalogClient, "listCategories">;

type CarryoverDependencies = {
  readonly createClient: (accessToken: string) => CarryoverPlanClient;
};

const defaultDependencies: CarryoverDependencies = {
  createClient: (accessToken) => new YnabBudgetClient(accessToken),
};

export async function carryoverPlanCommand(input: {
  readonly env: AppEnv;
  readonly options: CarryoverPlanOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<CarryoverDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const client = dependencies.createClient(input.env.ynabAccessToken);
  const closingMonth = parseBudgetMonth(input.options.month);
  const reversalMonth = nextBudgetMonth(closingMonth);
  const sourcePriority = parseSourcePriority(input.options.sources);
  const categories = await client.listCategories({ budgetId: input.options.budget });
  const categoryNames = new Map(categories.map((category) => [category.id, category.name] as const));
  const closingCatalogSnapshots = await readCategorySnapshots({
    client,
    budgetId: input.options.budget,
    month: closingMonth,
    categoryIds: categories.map((category) => category.id),
    categoryNames,
  });
  const closingSourceSnapshots = await readMissingSourceSnapshots({
    client,
    budgetId: input.options.budget,
    month: closingMonth,
    sourcePriority,
    knownSnapshots: closingCatalogSnapshots,
    categoryNames,
  });
  const reversalCategoryIds = unique([
    ...closingCatalogSnapshots.filter((snapshot) => snapshot.balance < 0).map((snapshot) => snapshot.categoryId),
    ...sourcePriority,
  ]);
  const reversalSnapshots = await readCategorySnapshots({
    client,
    budgetId: input.options.budget,
    month: reversalMonth,
    categoryIds: reversalCategoryIds,
    categoryNames,
  });
  const plan = planCarryover({
    budgetId: input.options.budget,
    closingMonth,
    reversalMonth,
    negativeCategories: closingCatalogSnapshots,
    sources: closingSourceSnapshots,
    reversalSnapshots,
    sourcePriority,
  });

  const format = input.options.json ? formatCarryoverPlanJson : formatCarryoverPlan;
  (input.stdout ?? process.stdout).write(`${format(plan)}\n`);
}

function parseSourcePriority(input: string): readonly string[] {
  const sourcePriority = input
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source.length > 0);

  if (sourcePriority.length === 0) {
    throw new Error("At least one source category ID is required");
  }

  const duplicates = sourcePriority.filter((source, index) => sourcePriority.indexOf(source) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate source category ID: ${duplicates[0]}`);
  }

  return sourcePriority;
}

async function readMissingSourceSnapshots(input: {
  readonly client: Pick<BudgetClient, "getCategoryMonth">;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly sourcePriority: readonly string[];
  readonly knownSnapshots: readonly CarryoverCategorySnapshot[];
  readonly categoryNames: ReadonlyMap<string, string>;
}): Promise<readonly CarryoverCategorySnapshot[]> {
  const knownById = new Map(input.knownSnapshots.map((snapshot) => [snapshot.categoryId, snapshot] as const));
  const missingSourceIds = input.sourcePriority.filter((categoryId) => !knownById.has(categoryId));
  const missingSourceSnapshots = await readCategorySnapshots({
    client: input.client,
    budgetId: input.budgetId,
    month: input.month,
    categoryIds: missingSourceIds,
    categoryNames: input.categoryNames,
  });
  const allSnapshots = [...input.knownSnapshots, ...missingSourceSnapshots];

  return input.sourcePriority.map((categoryId) => {
    const snapshot = allSnapshots.find((candidate) => candidate.categoryId === categoryId);
    if (!snapshot) {
      throw new Error(`Missing source category snapshot for ${categoryId}`);
    }

    return snapshot;
  });
}

async function readCategorySnapshots(input: {
  readonly client: Pick<BudgetClient, "getCategoryMonth">;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly categoryIds: readonly string[];
  readonly categoryNames: ReadonlyMap<string, string>;
}): Promise<readonly CarryoverCategorySnapshot[]> {
  return Promise.all(
    unique(input.categoryIds).map(async (categoryId) => {
      const snapshot = await input.client.getCategoryMonth({
        budgetId: input.budgetId,
        month: input.month,
        categoryId,
      });
      const categoryName = input.categoryNames.get(categoryId);

      return {
        categoryId,
        ...(categoryName ? { categoryName } : {}),
        ...snapshot,
      };
    }),
  );
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
