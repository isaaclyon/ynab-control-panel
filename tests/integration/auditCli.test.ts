import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("audit CLI", () => {
  it("prints audit status JSON without a YNAB access token", async () => {
    const auditLog = join(await mkdtemp(join(tmpdir(), "ynab-audit-cli-")), "audit.jsonl");
    await writeFile(auditLog, "", "utf8");

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "audit", "status", "--json"],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env["PATH"],
          HOME: process.env["HOME"],
          YNAB_AUDIT_LOG_FILE: auditLog,
          DOTENV_CONFIG_PATH: join(await mkdtemp(join(tmpdir(), "ynab-empty-env-")), ".env.missing"),
        },
      },
    );

    expect(JSON.parse(stdout)).toEqual({ entries: [], ignoredLineCount: 0 });
  });
});
