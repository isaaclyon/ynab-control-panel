import { z } from "zod";

export type BudgetMonth = string & { readonly __brand: "BudgetMonth" };

const budgetMonthPattern = /^\d{4}-\d{2}$/;

export function parseBudgetMonth(input: string): BudgetMonth {
  if (!budgetMonthPattern.test(input)) {
    throw new Error(`Budget month must use YYYY-MM, received ${input}`);
  }

  const month = Number.parseInt(input.slice(5, 7), 10);
  if (month < 1 || month > 12) {
    throw new Error(`Budget month must be between 01 and 12, received ${input}`);
  }

  return input as BudgetMonth;
}

export const budgetMonthSchema = z.string().transform((value, context) => {
  try {
    return parseBudgetMonth(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid budget month",
    });

    return z.NEVER;
  }
});

export function currentBudgetMonth(now = new Date()): BudgetMonth {
  const year = now.getUTCFullYear();
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");

  return parseBudgetMonth(`${year}-${month}`);
}

export function nextBudgetMonth(month: BudgetMonth): BudgetMonth {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const monthNumber = Number.parseInt(month.slice(5, 7), 10);

  if (monthNumber === 12) {
    return parseBudgetMonth(`${year + 1}-01`);
  }

  return parseBudgetMonth(`${year}-${(monthNumber + 1).toString().padStart(2, "0")}`);
}
