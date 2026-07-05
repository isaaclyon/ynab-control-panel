#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { parseEnv } from "./config/env.js";
import { listBudgetsCommand, listCategoriesCommand } from "./commands/listYnabCommand.js";
import { runTopUpsCommand } from "./commands/runTopUpsCommand.js";

const program = new Command();

program.name("ynab-control-panel").description("Backend-first YNAB automation utilities").version("0.1.0");

const run = program.command("run").description("Run YNAB automation jobs");
const list = program.command("list").description("List YNAB IDs for local rules configuration; read-only");

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

run
  .command("top-up")
  .description("Run monthly category top-up rules; dry-run unless --apply is provided")
  .option("--month <yyyy-mm>", "budget month to operate on; defaults to the current UTC month")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .option("--apply", "apply changes to YNAB instead of printing a dry run", false)
  .action(async (options: { month?: string; rules?: string; apply: boolean }) => {
    await runTopUpsCommand({ env: parseEnv(process.env), options });
  });

run
  .command("scheduled")
  .description("Scheduled entrypoint for all currently enabled jobs")
  .option("--month <yyyy-mm>", "budget month to operate on; defaults to the current UTC month")
  .option("--rules <path>", "rules JSON file; defaults to YNAB_RULES_FILE")
  .option("--apply", "apply changes to YNAB instead of printing a dry run", false)
  .action(async (options: { month?: string; rules?: string; apply: boolean }) => {
    await runTopUpsCommand({ env: parseEnv(process.env), options });
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
}
