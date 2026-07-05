import * as ynab from "ynab";
import type { BudgetMonth } from "../domain/month.js";
import { milliunits } from "../domain/money.js";
import type { BudgetClient, CategoryListItem, YnabCatalogClient } from "./budgetClient.js";

export type YnabApiPort = {
  readonly plans: {
    getPlans(includeAccounts?: boolean): Promise<{
      data: {
        plans: readonly {
          id: string;
          name: string;
        }[];
        default_plan?: {
          id: string;
          name: string;
        };
      };
    }>;
  };
  readonly categories: {
    getCategories(budgetId: string): Promise<{
      data: {
        category_groups: readonly {
          id: string;
          name: string;
          hidden: boolean;
          internal: boolean;
          deleted: boolean;
          categories: readonly {
            id: string;
            name: string;
            category_group_id: string;
            hidden: boolean;
            internal: boolean;
            deleted: boolean;
          }[];
        }[];
      };
    }>;
    getMonthCategoryById(
      budgetId: string,
      month: string,
      categoryId: string,
    ): Promise<{
      data: {
        category: {
          id: string;
          budgeted: number;
          activity: number;
          balance: number;
        };
      };
    }>;
    updateMonthCategory(
      budgetId: string,
      month: string,
      categoryId: string,
      data: { category: { budgeted: number } },
    ): Promise<unknown>;
  };
};

export class YnabBudgetClient implements BudgetClient, YnabCatalogClient {
  private readonly api: YnabApiPort;

  public constructor(accessToken: string, api: YnabApiPort = new ynab.API(accessToken) as unknown as YnabApiPort) {
    this.api = api;
  }

  public async getCategoryMonth(input: Parameters<BudgetClient["getCategoryMonth"]>[0]) {
    const response = await this.api.categories.getMonthCategoryById(
      input.budgetId,
      toYnabMonthParam(input.month),
      input.categoryId,
    );
    const category = response.data.category;

    if (category.id !== input.categoryId) {
      throw new Error(`YNAB returned category ${category.id} while reading ${input.categoryId}`);
    }

    return {
      budgeted: milliunits(category.budgeted),
      activity: milliunits(category.activity),
      balance: milliunits(category.balance),
    };
  }

  public async listBudgets() {
    const response = await this.api.plans.getPlans(false);
    const defaultBudgetId = response.data.default_plan?.id;

    return response.data.plans.map((budget) => ({
      id: budget.id,
      name: budget.name,
      isDefault: budget.id === defaultBudgetId,
    }));
  }

  public async listCategories(
    input: Parameters<YnabCatalogClient["listCategories"]>[0],
  ): Promise<readonly CategoryListItem[]> {
    const response = await this.api.categories.getCategories(input.budgetId);

    return response.data.category_groups.flatMap((categoryGroup) => {
      if (categoryGroup.internal || categoryGroup.deleted) {
        return [];
      }

      return categoryGroup.categories
        .filter((category) => !category.internal && !category.deleted)
        .map((category) => ({
          id: category.id,
          name: category.name,
          categoryGroupId: category.category_group_id,
          categoryGroupName: categoryGroup.name,
          hidden: categoryGroup.hidden || category.hidden,
        }));
    });
  }

  public async updateCategoryBudgeted(input: Parameters<BudgetClient["updateCategoryBudgeted"]>[0]): Promise<void> {
    await this.api.categories.updateMonthCategory(input.budgetId, toYnabMonthParam(input.month), input.categoryId, {
      category: { budgeted: input.budgeted },
    });
  }
}

function toYnabMonthParam(month: BudgetMonth): string {
  return `${month}-01`;
}
