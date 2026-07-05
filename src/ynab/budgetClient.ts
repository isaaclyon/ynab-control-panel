import type { BudgetMonth } from "../domain/month.js";
import type { Milliunits } from "../domain/money.js";
import type { CategoryMonthSnapshot } from "../domain/monthlyCategoryTopUp.js";

export interface BudgetClient {
  getCategoryMonth(input: {
    readonly budgetId: string;
    readonly month: BudgetMonth;
    readonly categoryId: string;
  }): Promise<CategoryMonthSnapshot>;

  updateCategoryBudgeted(input: {
    readonly budgetId: string;
    readonly month: BudgetMonth;
    readonly categoryId: string;
    readonly budgeted: Milliunits;
  }): Promise<void>;
}

export type BudgetListItem = {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
};

export type CategoryListItem = {
  readonly id: string;
  readonly name: string;
  readonly categoryGroupId: string;
  readonly categoryGroupName: string;
  readonly hidden: boolean;
};

export interface YnabCatalogClient {
  listBudgets(): Promise<readonly BudgetListItem[]>;

  listCategories(input: { readonly budgetId: string }): Promise<readonly CategoryListItem[]>;
}
