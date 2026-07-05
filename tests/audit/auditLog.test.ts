import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonlTopUpAuditLog } from "../../src/audit/auditLog.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";

describe("JSONL top-up audit log", () => {
  it("treats a missing log as no prior application", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "missing.jsonl"));

    await expect(log.hasClaimedOrApplied("rule-1", parseBudgetMonth("2026-07"))).resolves.toBe(false);
  });

  it("appends applied records and finds matching rule/month pairs", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "nested", "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");

    await log.append({
      kind: "monthly-category-top-up-applied",
      ruleId: "rule-1",
      budgetId: "budget-1",
      categoryId: "category-1",
      month,
      assignmentAmount: milliunits(50_000),
      budgetedAfter: milliunits(75_000),
      appliedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(log.hasClaimedOrApplied("rule-1", month)).resolves.toBe(true);
    await expect(log.hasClaimedOrApplied("rule-2", month)).resolves.toBe(false);
    await expect(log.hasClaimedOrApplied("rule-1", parseBudgetMonth("2026-08"))).resolves.toBe(false);
  });

  it("ignores malformed persisted audit lines so scheduled runs can continue", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl");
    await writeFile(path, `not-json\n${JSON.stringify({ kind: "wrong" })}\nnull\n`, "utf8");
    const log = new JsonlTopUpAuditLog(path);

    await expect(log.hasClaimedOrApplied("rule-1", parseBudgetMonth("2026-07"))).resolves.toBe(false);
  });

  it("treats pre-mutation claims as applied for duplicate-prevention", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");
    await log.append({
      kind: "monthly-category-top-up-claimed",
      ruleId: "rule-1",
      budgetId: "budget-1",
      categoryId: "category-1",
      month,
      assignmentAmount: milliunits(50_000),
      budgetedAfter: milliunits(75_000),
      claimedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(log.hasClaimedOrApplied("rule-1", month)).resolves.toBe(true);
  });

  it("serializes exclusive operations for the same rule and month", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");
    let releaseFirstOperation: (() => void) | undefined;
    const firstOperationEntered = new Promise<void>((resolve) => {
      void log.runExclusive("rule-1", month, async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseFirstOperation = release;
        });
      });
    });
    await firstOperationEntered;

    let secondEntered = false;
    const secondOperation = log.runExclusive("rule-1", month, async () => {
      secondEntered = true;
    });

    await Promise.resolve();
    expect(secondEntered).toBe(false);
    releaseFirstOperation?.();
    await secondOperation;
    expect(secondEntered).toBe(true);
  });

  it("removes stale locks before entering an exclusive operation", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl");
    const lockPath = `${path}.rule-1-2026-07.lock`;
    await writeFile(lockPath, "stale", "utf8");
    const staleTime = new Date(Date.now() - 11 * 60 * 1_000);
    await utimes(lockPath, staleTime, staleTime);
    const log = new JsonlTopUpAuditLog(path);
    let entered = false;

    await log.runExclusive("rule-1", parseBudgetMonth("2026-07"), async () => {
      entered = true;
    });

    expect(entered).toBe(true);
  });
});
