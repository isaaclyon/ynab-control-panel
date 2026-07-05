#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { AuditLogFileNotFoundError } from "./audit/auditLog.js";
import { parseAuditEnv, parseEnv, parseRulesEnv } from "./config/env.js";
import { auditInspectCommand, auditStatusCommand } from "./commands/auditCommand.js";
import { checkScheduledCommand, healthCheckPassed } from "./commands/checkScheduledCommand.js";
import { listBudgetsCommand, listCategoriesCommand } from "./commands/listYnabCommand.js";
import { runRulesCommand } from "./commands/runRulesCommand.js";
import { rulesExplainCommand, rulesListCommand, rulesValidateCommand } from "./commands/rulesCommand.js";

const program = new Command();

program.name("ynab-control-panel").description("Backend-first YNAB automation utilities").version("0.1.0");

const run = program.command("run").description("Run YNAB automation jobs");
const list = program.command("list").description("List YNAB IDs for local rules configuration; read-only");
const audit = program.command("audit").description("Inspect local audit history; read-only");
const check = program.command("check").description("Run read-only operational checks");
const rules = program.command("rules").description("Inspect local rules configuration without contacting YNAB");

check
  .command("scheduled")
  .description("Verify scheduled-run readiness without mutating YNAB")
  .option("--month <yyyy-mm>", "budget month to query; defaults to the current UTC month")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .action(async (options: { month?: string; rules?: string }) => {
    const report = await checkScheduledCommand({ env: process.env, options });
    if (!healthCheckPassed(report)) {
      process.exitCode = 1;
    }
  });

list
  .command("budgets")
  .description("List YNAB budgets with names and IDs; read-only and not redacted")
  .action(async () => {
    await listBudgetsCommand({ env: parseEnv(process.env) });
  });

list
  .command("categories")
  .description("List YNAB categories with names and IDs for a budget; read-only and not redacted")
  .requiredOption("--budget <budgetId>", "YNAB budget ID")
  .action(async (options: { budget: string }) => {
    await listCategoriesCommand({ env: parseEnv(process.env), options });
  });

audit
  .command("status")
  .description("List pending recovery operations from the local audit log; read-only")
  .option("--month <yyyy-mm>", "filter by budget month")
  .option("--budget <budgetId>", "filter by YNAB budget ID")
  .option("--rule <ruleId>", "filter by rule ID")
  .option("--audit-log <path>", "audit JSONL file; defaults to YNAB_AUDIT_LOG_FILE")
  .action(async (options: { month?: string; budget?: string; rule?: string; auditLog?: string }) => {
    await auditStatusCommand({ env: parseAuditEnv(process.env), options });
  });

audit
  .command("inspect")
  .description("Inspect audit state for one budget/rule/month key; read-only")
  .requiredOption("--month <yyyy-mm>", "budget month to inspect")
  .requiredOption("--budget <budgetId>", "YNAB budget ID")
  .requiredOption("--rule <ruleId>", "rule ID")
  .option("--audit-log <path>", "audit JSONL file; defaults to YNAB_AUDIT_LOG_FILE")
  .action(async (options: { month: string; budget: string; rule: string; auditLog?: string }) => {
    await auditInspectCommand({ env: parseAuditEnv(process.env), options });
  });

rules
  .command("validate")
  .description("Validate local rules JSON without contacting YNAB")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .action(async (options: { rules?: string }) => {
    await rulesValidateCommand({ env: parseRulesEnv(process.env), options });
  });

rules
  .command("list")
  .description("List configured rules without contacting YNAB")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .action(async (options: { rules?: string }) => {
    await rulesListCommand({ env: parseRulesEnv(process.env), options });
  });

rules
  .command("explain")
  .description("Explain one configured rule without contacting YNAB")
  .argument("<ruleId>", "rule ID from the local rules JSON")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .action(async (ruleId: string, options: { rules?: string }) => {
    await rulesExplainCommand({ env: parseRulesEnv(process.env), options: { ...options, ruleId } });
  });

run
  .command("rules")
  .description("Run all enabled budget rules; dry-run unless --apply is provided")
  .option("--month <yyyy-mm>", "budget month to operate on; defaults to the current UTC month")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .option("--apply", "apply changes to YNAB instead of printing a dry run", false)
  .action(async (options: { month?: string; rules?: string; apply: boolean }) => {
    await runRulesCommand({ env: parseEnv(process.env), options });
  });

run
  .command("top-up")
  .description("Compatibility alias for run rules; dry-run unless --apply is provided")
  .option("--month <yyyy-mm>", "budget month to operate on; defaults to the current UTC month")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .option("--apply", "apply changes to YNAB instead of printing a dry run", false)
  .action(async (options: { month?: string; rules?: string; apply: boolean }) => {
    await runRulesCommand({ env: parseEnv(process.env), options });
  });

run
  .command("scheduled")
  .description("Scheduled entrypoint for all currently enabled jobs")
  .option("--month <yyyy-mm>", "budget month to operate on; defaults to the current UTC month")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .option("--apply", "apply changes to YNAB instead of printing a dry run", false)
  .action(async (options: { month?: string; rules?: string; apply: boolean }) => {
    await runRulesCommand({ env: parseEnv(process.env), options });
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(
    error instanceof AuditLogFileNotFoundError
      ? error.message
      : error instanceof Error
        ? (error.stack ?? error.message)
        : error,
  );
  process.exitCode = 1;
}
