import type { AppEnv } from "../config/env.js";
import type { BudgetListItem, CategoryListItem, YnabCatalogClient } from "../ynab/budgetClient.js";
import { YnabBudgetClient } from "../ynab/ynabBudgetClient.js";

export type ListCategoriesOptions = {
  readonly budget: string;
};

type ListYnabDependencies = {
  readonly createCatalogClient: (accessToken: string) => YnabCatalogClient;
};

const defaultDependencies: ListYnabDependencies = {
  createCatalogClient: (accessToken) => new YnabBudgetClient(accessToken),
};

const fullLocalOutputNotice =
  "Full local output: YNAB names and IDs are not redacted so you can copy them into config/rules.json.";

export async function listBudgetsCommand(input: {
  readonly env: AppEnv;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<ListYnabDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const client = dependencies.createCatalogClient(input.env.ynabAccessToken);
  const budgets = await client.listBudgets();

  (input.stdout ?? process.stdout).write(`${formatBudgetList(budgets)}\n`);
}

export async function listCategoriesCommand(input: {
  readonly env: AppEnv;
  readonly options: ListCategoriesOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<ListYnabDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const client = dependencies.createCatalogClient(input.env.ynabAccessToken);
  const categories = await client.listCategories({ budgetId: input.options.budget });

  (input.stdout ?? process.stdout).write(`${formatCategoryList(input.options.budget, categories)}\n`);
}

export function formatBudgetList(budgets: readonly BudgetListItem[]): string {
  return [
    fullLocalOutputNotice,
    "budgetId\tname\tdefault",
    ...budgets.map((budget) => [budget.id, budget.name, budget.isDefault ? "yes" : ""].map(formatCell).join("\t")),
  ].join("\n");
}

export function formatCategoryList(budgetId: string, categories: readonly CategoryListItem[]): string {
  return [
    fullLocalOutputNotice,
    `Categories for budgetId: ${budgetId}`,
    "categoryId\tcategoryGroup\tcategory\tflags",
    ...categories.map((category) =>
      [category.id, category.categoryGroupName, category.name, category.hidden ? "hidden" : ""]
        .map(formatCell)
        .join("\t"),
    ),
  ].join("\n");
}

function formatCell(value: string): string {
  return value.replace(/[\t\n\r]+/g, " ");
}
