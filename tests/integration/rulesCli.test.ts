import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("rules inspection CLI", () => {
  it.each([
    ["validate", ["validate"], "Rules config valid:"],
    ["list", ["list"], "top-up-1\tmonthly-category-top-up\tyes\tbudget-1\tcategory-1"],
    ["explain", ["explain", "top-up-1"], "effect: assigns up to $50.00 to category-1"],
  ])("runs rules %s without a YNAB access token", async (_name, args, expectedOutput) => {
    const rulesFile = await writeRulesFixture();

    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", "rules", ...args], {
      cwd: process.cwd(),
      env: {
        PATH: process.env["PATH"],
        HOME: process.env["HOME"],
        YNAB_RULES_FILE: rulesFile,
        DOTENV_CONFIG_PATH: join(await mkdtemp(join(tmpdir(), "ynab-empty-env-")), ".env.missing"),
      },
    });

    expect(stdout).toContain(expectedOutput);
    expect(stdout).toContain("No YNAB calls were performed.");
  });
});

async function writeRulesFixture(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "ynab-rules-cli-")), "rules.json");
  await writeFile(
    path,
    JSON.stringify({
      rules: [
        {
          id: "top-up-1",
          type: "monthly-category-top-up",
          budgetId: "budget-1",
          categoryId: "category-1",
          monthlyAmount: "50.00",
          targetBalance: "200.00",
        },
      ],
    }),
    "utf8",
  );

  return path;
}
