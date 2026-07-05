import type { CategoryAvailableTransferRule } from "./categoryAvailableTransfer.js";
import type { MonthlyCategoryTopUpRule } from "./monthlyCategoryTopUp.js";

export type BudgetRule = MonthlyCategoryTopUpRule | CategoryAvailableTransferRule;
