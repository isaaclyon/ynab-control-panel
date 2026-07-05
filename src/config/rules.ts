import { readFile } from "node:fs/promises";
import { z } from "zod";
import { dollarAmountSchema } from "../domain/money.js";
import type { MonthlyCategoryTopUpRule } from "../domain/monthlyCategoryTopUp.js";

export type RulesConfig = {
  readonly rules: readonly MonthlyCategoryTopUpRule[];
};

const monthlyCategoryTopUpRuleSchema = z.object({
  id: z.string().min(1),
  type: z.literal("monthly-category-top-up"),
  budgetId: z.string().min(1),
  categoryId: z.string().min(1),
  monthlyAmount: dollarAmountSchema.refine((value) => value > 0, "monthlyAmount must be positive"),
  targetBalance: dollarAmountSchema.refine((value) => value >= 0, "targetBalance cannot be negative"),
});

const rulesConfigSchema = z.object({
  rules: z.array(monthlyCategoryTopUpRuleSchema).min(1),
});

export function parseRulesConfig(input: unknown): RulesConfig {
  return rulesConfigSchema.parse(input);
}

export async function loadRulesConfig(path: string): Promise<RulesConfig> {
  const contents = await readFile(path, "utf8");
  return parseRulesConfig(JSON.parse(contents));
}
