#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { parseEnv } from "./config/env.js";
import { runTopUpsCommand } from "./commands/runTopUpsCommand.js";

const program = new Command();

program
  .name("ynab-control-panel")
  .description("Backend-first YNAB automation utilities")
  .version("0.1.0");

const run = program.command("run").description("Run YNAB automation jobs");

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
