import "dotenv/config";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ynab from "ynab";
import { JsonlTopUpAuditLog } from "../src/audit/auditLog.js";
import { parseRulesConfig } from "../src/config/rules.js";
import { currentBudgetMonth } from "../src/domain/month.js";
import { formatTopUpRunResults, runMonthlyCategoryTopUps } from "../src/jobs/runMonthlyCategoryTopUps.js";
import { YnabBudgetClient } from "../src/ynab/ynabBudgetClient.js";

const accessToken = process.env["YNAB_ACCESS_TOKEN"];

if (!accessToken || accessToken === "replace-me") {
  throw new Error("YNAB_ACCESS_TOKEN must be set in .env before running the live smoke test");
}

const api = new ynab.API(accessToken);
const plansResponse = await api.plans.getPlans(false);
const plan = plansResponse.data.plans[0];

if (!plan) {
  throw new Error("YNAB connectivity succeeded, but no plans were found");
}

const categoriesResponse = await api.categories.getCategories(plan.id);
const category = categoriesResponse.data.category_groups
  .flatMap((group) => group.categories ?? [])
  .find((candidate) => !candidate.hidden && !candidate.deleted && !candidate.internal);

if (!category) {
  throw new Error("YNAB connectivity succeeded, but no visible categories were found");
}

const smokeRule = parseRulesConfig({
  rules: [
    {
      id: "live-smoke-top-up",
      type: "monthly-category-top-up",
      budgetId: plan.id,
      categoryId: category.id,
      monthlyAmount: "0.01",
      targetBalance: "0.01",
    },
  ],
});
const smokeDir = await mkdtemp(join(tmpdir(), "ynab-live-smoke-"));
const auditLog = new JsonlTopUpAuditLog(join(smokeDir, "audit.jsonl"));
const results = await runMonthlyCategoryTopUps({
  config: smokeRule,
  month: currentBudgetMonth(),
  dryRun: true,
  budgetClient: new YnabBudgetClient(accessToken),
  auditLog,
});

await writeFile(join(smokeDir, "rules.json"), JSON.stringify(smokeRule, null, 2), "utf8");

console.log(`YNAB live smoke OK: found ${plansResponse.data.plans.length} plan(s).`);
console.log(`Using temporary dry-run rule in ${smokeDir}`);
console.log(redact(formatTopUpRunResults(results)));
console.log("No YNAB changes were applied.");

function redact(output: string): string {
  return output
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id-redacted>")
    .replace(/\$-?\d+\.\d{2}/g, "$<amount-redacted>");
}
