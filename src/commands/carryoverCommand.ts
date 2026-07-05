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

export async function carryoverPlanCommand(input: {
  readonly env: AppEnv;
  readonly options: CarryoverPlanOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<CarryoverDependencies>;
}): Promise<void> {
  const createClient = input.dependencies?.createClient ?? ((accessToken: string) => new YnabBudgetClient(accessToken));
  const client = createClient(input.env.ynabAccessToken);
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
  const closingSourceSnapshots = await readSourceSnapshots({
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
  const sourcePriority: string[] = [];
  const seenSourceIds = new Set<string>();

  for (const rawSource of input.split(",")) {
    const source = rawSource.trim();
    if (source.length === 0) {
      continue;
    }

    if (seenSourceIds.has(source)) {
      throw new Error(`Duplicate source category ID: ${source}`);
    }

    seenSourceIds.add(source);
    sourcePriority.push(source);
  }

  if (sourcePriority.length === 0) {
    throw new Error("At least one source category ID is required");
  }

  return sourcePriority;
}

async function readSourceSnapshots(input: {
  readonly client: Pick<BudgetClient, "getCategoryMonth">;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly sourcePriority: readonly string[];
  readonly knownSnapshots: readonly CarryoverCategorySnapshot[];
  readonly categoryNames: ReadonlyMap<string, string>;
}): Promise<readonly CarryoverCategorySnapshot[]> {
  const snapshotsById = new Map(input.knownSnapshots.map((snapshot) => [snapshot.categoryId, snapshot] as const));
  const missingSourceIds = input.sourcePriority.filter((categoryId) => !snapshotsById.has(categoryId));
  const missingSourceSnapshots = await readCategorySnapshots({
    client: input.client,
    budgetId: input.budgetId,
    month: input.month,
    categoryIds: missingSourceIds,
    categoryNames: input.categoryNames,
  });

  for (const snapshot of missingSourceSnapshots) {
    snapshotsById.set(snapshot.categoryId, snapshot);
  }

  return input.sourcePriority.map((categoryId) => {
    const snapshot = snapshotsById.get(categoryId);
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
