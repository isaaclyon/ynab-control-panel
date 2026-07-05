import { readFile } from "node:fs/promises";
import { z } from "zod";
import { dollarAmountSchema } from "../domain/money.js";
import type { BudgetRule } from "../domain/budgetRule.js";

export type RulesConfig = {
  readonly rules: readonly BudgetRule[];
};

const enabledSchema = z.boolean().default(true);
const ruleDescriptionSchema = z.string().trim().min(1, "description cannot be blank").optional();

const monthlyCategoryTopUpRuleSchema = z.object({
  id: z.string().min(1),
  type: z.literal("monthly-category-top-up"),
  description: ruleDescriptionSchema,
  enabled: enabledSchema,
  budgetId: z.string().min(1),
  categoryId: z.string().min(1),
  monthlyAmount: dollarAmountSchema.refine((value) => value > 0, "monthlyAmount must be positive"),
  targetBalance: dollarAmountSchema.refine((value) => value >= 0, "targetBalance cannot be negative"),
});

const fixedAmountPolicySchema = z.object({
  type: z.literal("fixed"),
  amount: dollarAmountSchema.refine((value) => value > 0, "amount must be positive"),
});

const percentOfAvailableAmountPolicySchema = z.object({
  type: z.literal("percent-of-available"),
  percent: z.number().positive().max(100),
  max: dollarAmountSchema.refine((value) => value > 0, "max must be positive").optional(),
});

const amountPolicySchema = z.discriminatedUnion("type", [
  fixedAmountPolicySchema,
  percentOfAvailableAmountPolicySchema,
]);

const categoryAvailableTransferRuleSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("category-available-transfer"),
    description: ruleDescriptionSchema,
    enabled: enabledSchema,
    budgetId: z.string().min(1),
    fromCategoryId: z.string().min(1),
    toCategoryId: z.string().min(1),
    amount: amountPolicySchema,
    leaveAvailable: dollarAmountSchema.refine((value) => value >= 0, "leaveAvailable cannot be negative"),
  })
  .refine((rule) => rule.fromCategoryId !== rule.toCategoryId, {
    message: "fromCategoryId and toCategoryId must be different",
    path: ["toCategoryId"],
  });

const budgetRuleSchema = z.discriminatedUnion("type", [
  monthlyCategoryTopUpRuleSchema,
  categoryAvailableTransferRuleSchema,
]);

const rulesConfigSchema = z.object({
  rules: z.array(budgetRuleSchema).min(1),
});

export function parseRulesConfig(input: unknown): RulesConfig {
  const config = rulesConfigSchema.parse(input);
  assertUniqueRuleIds(config.rules);
  return config;
}

export async function loadRulesConfig(path: string): Promise<RulesConfig> {
  const contents = await readFile(path, "utf8");
  return parseRulesConfig(JSON.parse(contents));
}

function assertUniqueRuleIds(rules: readonly { readonly id: string }[]): void {
  const seen = new Set<string>();

  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["rules"],
          message: `Duplicate rule id: ${rule.id}`,
          input: rules,
        },
      ]);
    }

    seen.add(rule.id);
  }
}
