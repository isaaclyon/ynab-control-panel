import * as ynab from "ynab";
import { milliunits } from "../domain/money.js";
import type { BudgetClient } from "./budgetClient.js";

type YnabApiPort = {
  readonly categories: {
    getMonthCategoryById(
      budgetId: string,
      month: string,
      categoryId: string
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
      data: { category: { budgeted: number } }
    ): Promise<unknown>;
  };
};

export class YnabBudgetClient implements BudgetClient {
  private readonly api: YnabApiPort;

  public constructor(accessToken: string, api: YnabApiPort = new ynab.API(accessToken) as unknown as YnabApiPort) {
    this.api = api;
  }

  public async getCategoryMonth(input: Parameters<BudgetClient["getCategoryMonth"]>[0]) {
    const response = await this.api.categories.getMonthCategoryById(input.budgetId, input.month, input.categoryId);
    const category = response.data.category;

    if (category.id !== input.categoryId) {
      throw new Error(`YNAB returned category ${category.id} while reading ${input.categoryId}`);
    }

    return {
      budgeted: milliunits(category.budgeted),
      activity: milliunits(category.activity),
      balance: milliunits(category.balance)
    };
  }

  public async updateCategoryBudgeted(input: Parameters<BudgetClient["updateCategoryBudgeted"]>[0]): Promise<void> {
    await this.api.categories.updateMonthCategory(input.budgetId, input.month, input.categoryId, {
      category: { budgeted: input.budgeted }
    });
  }
}
