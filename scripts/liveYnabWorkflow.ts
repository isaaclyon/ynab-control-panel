import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ynab from "ynab";
import { JsonlBudgetOperationAuditLog, type OperationAuditState } from "../src/audit/auditLog.js";
import type { CategoryMonthSnapshot } from "../src/domain/categoryMonth.js";
import type { BudgetRule } from "../src/domain/budgetRule.js";
import { currentBudgetMonth, parseBudgetMonth, type BudgetMonth } from "../src/domain/month.js";
import { formatMilliunits, milliunits, parseDollarAmount, type Milliunits } from "../src/domain/money.js";
import { formatBudgetRuleRunResults, runBudgetRules, type BudgetRuleRunResult } from "../src/jobs/runBudgetRules.js";
import type { BudgetClient, CategoryListItem } from "../src/ynab/budgetClient.js";
import { YnabBudgetClient } from "../src/ynab/ynabBudgetClient.js";

const allowMutationsEnvVar = "YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS";
const budgetIdEnvVar = "YNAB_LIVE_WORKFLOW_BUDGET_ID";
const monthEnvVar = "YNAB_LIVE_WORKFLOW_MONTH";
const verboseEnvVar = "YNAB_LIVE_WORKFLOW_VERBOSE";
const categoryGroupName = "Automation Test";
const categoryNames = {
  topUpTarget: "Top Up Target",
  transferSource: "Transfer Source",
  transferDestination: "Transfer Destination",
} as const;

const topUpAmount = parseDollarAmount("10.00");
const transferSourceStartingBudgeted = parseDollarAmount("10.00");
const transferAmount = parseDollarAmount("3.00");
const transferLeaveAvailable = parseDollarAmount("7.00");
const zero = milliunits(0);

export type LiveYnabWorkflowEnv = {
  readonly accessToken: string;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly verboseLogs: boolean;
};

type LiveYnabApi = {
  readonly categories: {
    getCategories(budgetId: string): Promise<{
      data: { category_groups: readonly YnabCategoryGroup[] };
    }>;
    createCategoryGroup(
      budgetId: string,
      data: { category_group: { name: string } },
    ): Promise<{ data: { category_group: YnabCategoryGroup } }>;
    createCategory(
      budgetId: string,
      data: { category: { name: string; category_group_id: string } },
    ): Promise<{ data: { category: YnabCategory } }>;
  };
};

type YnabCategoryGroup = {
  readonly id: string;
  readonly name: string;
  readonly hidden?: boolean;
  readonly internal?: boolean;
  readonly deleted?: boolean;
  readonly categories?: readonly YnabCategory[];
};

type YnabCategory = {
  readonly id: string;
  readonly name: string;
  readonly category_group_id: string;
  readonly hidden?: boolean;
  readonly internal?: boolean;
  readonly deleted?: boolean;
};

type WorkflowCategories = {
  readonly topUpTarget: CategoryListItem;
  readonly transferSource: CategoryListItem;
  readonly transferDestination: CategoryListItem;
};

export function parseLiveYnabWorkflowEnv(
  env: NodeJS.ProcessEnv,
  options: { readonly getCurrentBudgetMonth?: () => BudgetMonth } = {},
): LiveYnabWorkflowEnv {
  if (env[allowMutationsEnvVar] !== "true") {
    throw new Error(`${allowMutationsEnvVar}=true is required because this live workflow mutates a YNAB budget`);
  }

  const accessToken = env["YNAB_ACCESS_TOKEN"];
  if (!accessToken || accessToken === "replace-me") {
    throw new Error("YNAB_ACCESS_TOKEN must be set before running the live workflow");
  }

  const budgetId = env[budgetIdEnvVar];
  if (!budgetId) {
    throw new Error(`${budgetIdEnvVar} must be set to an isolated YNAB test budget ID`);
  }

  return {
    accessToken,
    budgetId,
    month: env[monthEnvVar]
      ? parseBudgetMonth(env[monthEnvVar])
      : (options.getCurrentBudgetMonth ?? currentBudgetMonth)(),
    verboseLogs: env[verboseEnvVar] === "true",
  };
}

export async function runLiveYnabWorkflow(env: LiveYnabWorkflowEnv): Promise<void> {
  const api = new ynab.API(env.accessToken) as unknown as LiveYnabApi;
  const budgetClient = new YnabBudgetClient(env.accessToken);
  const categories = await ensureWorkflowCategories({ api, budgetId: env.budgetId });
  const auditDir = await mkdtemp(join(tmpdir(), "ynab-live-workflow-"));
  const auditLog = new JsonlBudgetOperationAuditLog(join(auditDir, "audit.jsonl"));
  const restoreConsole = configureWorkflowLogging(env.verboseLogs);

  try {
    console.log("YNAB live workflow starting.");
    console.log(`Budget: ${env.budgetId}`);
    console.log(`Month: ${env.month}`);
    console.log(`Audit log: ${join(auditDir, "audit.jsonl")}`);
    console.log(`Category group: ${categoryGroupName}`);
    console.log(
      `Categories: ${Object.values(categories)
        .map((category) => `${category.name}=${category.id}`)
        .join(", ")}`,
    );

    await resetWorkflowCategories({ budgetClient, budgetId: env.budgetId, month: env.month, categories });

    const categoryNameLookup = ({ categoryId }: { readonly categoryId: string }) =>
      categoryDisplayName(categories, categoryId);
    const topUpRule = buildTopUpRule({ budgetId: env.budgetId, categoryId: categories.topUpTarget.id });
    const transferRule = buildTransferRule({
      budgetId: env.budgetId,
      fromCategoryId: categories.transferSource.id,
      toCategoryId: categories.transferDestination.id,
    });

    console.log("\n1. Dry-run top-up rule");
    expectSingleStatus(
      await runRule({ rule: topUpRule, month: env.month, dryRun: true, budgetClient, auditLog, categoryNameLookup }),
      "dry-run",
    );
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      snapshot: { budgeted: zero, activity: zero, balance: zero },
    });
    await expectAuditState({ auditLog, budgetId: env.budgetId, month: env.month, ruleId: topUpRule.id, state: "none" });

    console.log("\n2. Apply top-up rule");
    expectSingleStatus(
      await runRule({ rule: topUpRule, month: env.month, dryRun: false, budgetClient, auditLog, categoryNameLookup }),
      "applied",
    );
    await expectBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      budgeted: topUpAmount,
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      snapshot: { budgeted: topUpAmount, activity: zero, balance: topUpAmount },
    });

    console.log("\n3. Re-run top-up after apply; rule should be a no-op");
    expectSingleStatus(
      await runRule({ rule: topUpRule, month: env.month, dryRun: true, budgetClient, auditLog, categoryNameLookup }),
      "skipped-no-op",
    );
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      snapshot: { budgeted: topUpAmount, activity: zero, balance: topUpAmount },
    });

    console.log("\n4. Reset top-up category and prove audit idempotency blocks duplicate apply");
    await setBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      budgeted: zero,
    });
    expectSingleStatus(
      await runRule({ rule: topUpRule, month: env.month, dryRun: false, budgetClient, auditLog, categoryNameLookup }),
      "skipped-already-applied",
    );
    await expectBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      budgeted: zero,
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.topUpTarget,
      snapshot: { budgeted: zero, activity: zero, balance: zero },
    });

    console.log("\n5. Reset transfer categories, then dry-run transfer rule");
    await setBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      budgeted: transferSourceStartingBudgeted,
    });
    await setBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      budgeted: zero,
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      snapshot: { budgeted: transferSourceStartingBudgeted, activity: zero, balance: transferSourceStartingBudgeted },
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      snapshot: { budgeted: zero, activity: zero, balance: zero },
    });
    expectSingleStatus(
      await runRule({ rule: transferRule, month: env.month, dryRun: true, budgetClient, auditLog, categoryNameLookup }),
      "dry-run",
    );
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      snapshot: { budgeted: transferSourceStartingBudgeted, activity: zero, balance: transferSourceStartingBudgeted },
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      snapshot: { budgeted: zero, activity: zero, balance: zero },
    });
    await expectAuditState({
      auditLog,
      budgetId: env.budgetId,
      month: env.month,
      ruleId: transferRule.id,
      state: "none",
    });

    console.log("\n6. Apply transfer rule");
    expectSingleStatus(
      await runRule({
        rule: transferRule,
        month: env.month,
        dryRun: false,
        budgetClient,
        auditLog,
        categoryNameLookup,
      }),
      "applied",
    );
    await expectBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      budgeted: transferLeaveAvailable,
    });
    await expectBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      budgeted: transferAmount,
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      snapshot: { budgeted: transferLeaveAvailable, activity: zero, balance: transferLeaveAvailable },
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      snapshot: { budgeted: transferAmount, activity: zero, balance: transferAmount },
    });

    console.log("\n7. Re-run transfer after apply; rule should be a no-op at leaveAvailable floor");
    expectSingleStatus(
      await runRule({ rule: transferRule, month: env.month, dryRun: true, budgetClient, auditLog, categoryNameLookup }),
      "skipped-no-op",
    );
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      snapshot: { budgeted: transferLeaveAvailable, activity: zero, balance: transferLeaveAvailable },
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      snapshot: { budgeted: transferAmount, activity: zero, balance: transferAmount },
    });

    console.log("\n8. Reset transfer categories and prove audit idempotency blocks duplicate apply");
    await setBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      budgeted: transferSourceStartingBudgeted,
    });
    await setBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      budgeted: zero,
    });
    expectSingleStatus(
      await runRule({
        rule: transferRule,
        month: env.month,
        dryRun: false,
        budgetClient,
        auditLog,
        categoryNameLookup,
      }),
      "skipped-already-applied",
    );
    await expectBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      budgeted: transferSourceStartingBudgeted,
    });
    await expectBudgeted({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      budgeted: zero,
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferSource,
      snapshot: { budgeted: transferSourceStartingBudgeted, activity: zero, balance: transferSourceStartingBudgeted },
    });
    await expectCategoryMonth({
      budgetClient,
      budgetId: env.budgetId,
      month: env.month,
      category: categories.transferDestination,
      snapshot: { budgeted: zero, activity: zero, balance: zero },
    });
  } finally {
    try {
      console.log("\nCleanup: reset workflow category budgeted amounts to $0.00 and remove the temporary audit log");
      try {
        await resetWorkflowCategories({ budgetClient, budgetId: env.budgetId, month: env.month, categories });
      } finally {
        await rm(auditDir, { recursive: true, force: true });
      }
    } finally {
      restoreConsole();
    }
  }

  console.log("\nYNAB live workflow passed.");
}

async function ensureWorkflowCategories(input: {
  readonly api: LiveYnabApi;
  readonly budgetId: string;
}): Promise<WorkflowCategories> {
  const group = await ensureCategoryGroup(input);
  const topUpTarget = await ensureCategory(input, group.id, categoryNames.topUpTarget);
  const transferSource = await ensureCategory(input, group.id, categoryNames.transferSource);
  const transferDestination = await ensureCategory(input, group.id, categoryNames.transferDestination);

  return {
    topUpTarget: toCategoryListItem(topUpTarget, group),
    transferSource: toCategoryListItem(transferSource, group),
    transferDestination: toCategoryListItem(transferDestination, group),
  };
}

async function ensureCategoryGroup(input: {
  readonly api: LiveYnabApi;
  readonly budgetId: string;
}): Promise<YnabCategoryGroup> {
  const existing = (await input.api.categories.getCategories(input.budgetId)).data.category_groups.find(
    (group) => !group.deleted && !group.internal && group.name === categoryGroupName,
  );

  if (existing) {
    return existing;
  }

  return (
    await input.api.categories.createCategoryGroup(input.budgetId, { category_group: { name: categoryGroupName } })
  ).data.category_group;
}

async function ensureCategory(
  input: { readonly api: LiveYnabApi; readonly budgetId: string },
  categoryGroupId: string,
  name: string,
): Promise<YnabCategory> {
  const existing = (await input.api.categories.getCategories(input.budgetId)).data.category_groups
    .flatMap((group) => group.categories ?? [])
    .find(
      (category) =>
        !category.deleted &&
        !category.internal &&
        category.category_group_id === categoryGroupId &&
        category.name === name,
    );

  if (existing) {
    return existing;
  }

  return (
    await input.api.categories.createCategory(input.budgetId, {
      category: { name, category_group_id: categoryGroupId },
    })
  ).data.category;
}

function toCategoryListItem(category: YnabCategory, group: YnabCategoryGroup): CategoryListItem {
  return {
    id: category.id,
    name: category.name,
    categoryGroupId: group.id,
    categoryGroupName: group.name,
    hidden: Boolean(group.hidden || category.hidden),
  };
}

async function resetWorkflowCategories(input: {
  readonly budgetClient: YnabBudgetClient;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly categories: WorkflowCategories;
}): Promise<void> {
  for (const category of Object.values(input.categories)) {
    await setBudgeted({ ...input, category, budgeted: zero });
  }
}

function buildTopUpRule(input: { readonly budgetId: string; readonly categoryId: string }): BudgetRule {
  return {
    id: "live-workflow-top-up",
    type: "monthly-category-top-up",
    enabled: true,
    description: "Live workflow top-up rule",
    budgetId: input.budgetId,
    categoryId: input.categoryId,
    monthlyAmount: topUpAmount,
    targetBalance: topUpAmount,
  };
}

function buildTransferRule(input: {
  readonly budgetId: string;
  readonly fromCategoryId: string;
  readonly toCategoryId: string;
}): BudgetRule {
  return {
    id: "live-workflow-transfer",
    type: "category-available-transfer",
    enabled: true,
    description: "Live workflow transfer rule",
    budgetId: input.budgetId,
    fromCategoryId: input.fromCategoryId,
    toCategoryId: input.toCategoryId,
    amount: { type: "fixed", amount: transferAmount },
    leaveAvailable: transferLeaveAvailable,
  };
}

async function runRule(input: {
  readonly rule: BudgetRule;
  readonly month: BudgetMonth;
  readonly dryRun: boolean;
  readonly budgetClient: YnabBudgetClient;
  readonly auditLog: JsonlBudgetOperationAuditLog;
  readonly categoryNameLookup: (input: { readonly categoryId: string }) => string | undefined;
}): Promise<readonly BudgetRuleRunResult[]> {
  const results = await runBudgetRules({
    config: { rules: [input.rule] },
    month: input.month,
    dryRun: input.dryRun,
    budgetClient: input.budgetClient,
    auditLog: input.auditLog,
    categoryNameLookup: input.categoryNameLookup,
  });

  console.log(formatBudgetRuleRunResults(results));
  return results;
}

function configureWorkflowLogging(verboseLogs: boolean): () => void {
  if (verboseLogs) {
    return () => {};
  }

  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    originalLog(...values.map((value) => redactLiveWorkflowOutput(String(value))));
  };

  return () => {
    console.log = originalLog;
  };
}

export function redactLiveWorkflowOutput(output: string): string {
  return output
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id-redacted>")
    .replace(/[+-]?\$-?\d+\.\d{2}/g, "$<amount-redacted>");
}

function expectSingleStatus(results: readonly BudgetRuleRunResult[], status: BudgetRuleRunResult["status"]): void {
  const result = results[0];
  if (results.length !== 1 || !result || result.status !== status) {
    throw new Error(
      `Expected one ${status} result, received ${results.map((candidate) => candidate.status).join(", ")}`,
    );
  }
}

async function setBudgeted(input: {
  readonly budgetClient: YnabBudgetClient;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly category: CategoryListItem;
  readonly budgeted: Milliunits;
}): Promise<void> {
  await input.budgetClient.updateCategoryBudgeted({
    budgetId: input.budgetId,
    month: input.month,
    categoryId: input.category.id,
    budgeted: input.budgeted,
  });
  console.log(`  reset ${input.category.name} budgeted to ${formatMilliunits(input.budgeted)}`);
}

async function expectBudgeted(input: {
  readonly budgetClient: YnabBudgetClient;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly category: CategoryListItem;
  readonly budgeted: Milliunits;
}): Promise<void> {
  const snapshot = await input.budgetClient.getCategoryMonth({
    budgetId: input.budgetId,
    month: input.month,
    categoryId: input.category.id,
  });

  if (snapshot.budgeted !== input.budgeted) {
    throw new Error(
      `Expected ${input.category.name} budgeted to be ${formatMilliunits(input.budgeted)}, received ${formatMilliunits(snapshot.budgeted)}`,
    );
  }

  console.log(`  verified ${input.category.name} budgeted is ${formatMilliunits(snapshot.budgeted)}`);
}

export async function expectCategoryMonth(input: {
  readonly budgetClient: BudgetClient;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly category: CategoryListItem;
  readonly snapshot: CategoryMonthSnapshot;
}): Promise<void> {
  const actual = await input.budgetClient.getCategoryMonth({
    budgetId: input.budgetId,
    month: input.month,
    categoryId: input.category.id,
  });

  assertCategoryMonthSnapshot(input.category.name, actual, input.snapshot);
  console.log(
    `  verified ${input.category.name} snapshot is budgeted=${formatMilliunits(actual.budgeted)}, activity=${formatMilliunits(actual.activity)}, balance=${formatMilliunits(actual.balance)}`,
  );
}

export function assertCategoryMonthSnapshot(
  categoryName: string,
  actual: CategoryMonthSnapshot,
  expected: CategoryMonthSnapshot,
): void {
  if (
    actual.budgeted !== expected.budgeted ||
    actual.activity !== expected.activity ||
    actual.balance !== expected.balance
  ) {
    throw new Error(
      `Expected ${categoryName} snapshot to be budgeted=${formatMilliunits(expected.budgeted)}, activity=${formatMilliunits(expected.activity)}, balance=${formatMilliunits(expected.balance)}; received budgeted=${formatMilliunits(actual.budgeted)}, activity=${formatMilliunits(actual.activity)}, balance=${formatMilliunits(actual.balance)}`,
    );
  }
}

async function expectAuditState(input: {
  readonly auditLog: JsonlBudgetOperationAuditLog;
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly ruleId: string;
  readonly state: OperationAuditState;
}): Promise<void> {
  const actual = await input.auditLog.getOperationState({
    budgetId: input.budgetId,
    month: input.month,
    ruleId: input.ruleId,
  });

  if (actual !== input.state) {
    throw new Error(`Expected audit state for ${input.ruleId} to be ${input.state}, received ${actual}`);
  }

  console.log(`  verified audit state for ${input.ruleId} is ${actual}`);
}

function categoryDisplayName(categories: WorkflowCategories, categoryId: string): string | undefined {
  return Object.values(categories).find((category) => category.id === categoryId)?.name;
}

async function main(): Promise<void> {
  const env = parseLiveYnabWorkflowEnv(process.env);
  await runLiveYnabWorkflow(env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(process.env[verboseEnvVar] === "true" ? message : redactLiveWorkflowOutput(message));
    process.exitCode = 1;
  });
}
