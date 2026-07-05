import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AuditLogFileNotFoundError, JsonlTopUpAuditLog } from "../../src/audit/auditLog.js";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";

describe("JSONL top-up audit log", () => {
  it("treats a missing log as no prior application", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "missing.jsonl"));

    await expect(log.hasClaimedOrApplied("rule-1", parseBudgetMonth("2026-07"))).resolves.toBe(false);
  });

  it("surfaces a missing log during explicit audit scans", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "missing.jsonl");
    const log = new JsonlTopUpAuditLog(path);

    await expect(log.scanOperationAuditEntries()).rejects.toEqual(new AuditLogFileNotFoundError(path));
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

  it("persists generic operation claims and distinguishes claim-only from applied", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");

    await log.append({
      kind: "budget-operation-claimed",
      ruleId: "transfer-1",
      ruleType: "category-available-transfer",
      budgetId: "budget-1",
      month,
      operation: {
        ruleId: "transfer-1",
        ruleType: "category-available-transfer",
        budgetId: "budget-1",
        month,
        summary: "move $50.00 from source to destination",
        reason: "transfer-needed",
        updates: [
          {
            categoryId: "source",
            budgetedBefore: milliunits(100_000),
            budgetedAfter: milliunits(50_000),
            delta: milliunits(-50_000),
            role: "source",
          },
          {
            categoryId: "destination",
            budgetedBefore: milliunits(10_000),
            budgetedAfter: milliunits(60_000),
            delta: milliunits(50_000),
            role: "destination",
          },
        ],
      },
      claimedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(log.getOperationState({ ruleId: "transfer-1", budgetId: "budget-1", month })).resolves.toBe("claimed");

    await log.append({
      kind: "budget-operation-applied",
      ruleId: "transfer-1",
      ruleType: "category-available-transfer",
      budgetId: "budget-1",
      month,
      appliedAt: "2026-07-01T00:00:01.000Z",
    });

    await expect(log.getOperationState({ ruleId: "transfer-1", budgetId: "budget-1", month })).resolves.toBe("applied");
  });

  it("keys generic operation state by budget id as well as rule and month", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");

    await log.append({
      kind: "budget-operation-applied",
      ruleId: "rule-1",
      ruleType: "monthly-category-top-up",
      budgetId: "budget-1",
      month,
      appliedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(log.getOperationState({ ruleId: "rule-1", budgetId: "budget-1", month })).resolves.toBe("applied");
    await expect(log.getOperationState({ ruleId: "rule-1", budgetId: "budget-2", month })).resolves.toBe("none");
  });

  it("scans claim-only operations for pending recovery with strict filters", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");

    await log.append(
      genericClaim({ ruleId: "transfer-1", budgetId: "budget-1", month, claimedAt: "2026-07-01T00:00:00.000Z" }),
    );
    await log.append(
      genericClaim({ ruleId: "transfer-2", budgetId: "budget-2", month, claimedAt: "2026-07-01T00:01:00.000Z" }),
    );

    const scan = await log.scanOperationAuditEntries({ state: "claimed", budgetId: "budget-1", month });

    expect(scan.ignoredLineCount).toBe(0);
    expect(scan.entries).toHaveLength(1);
    expect(scan.entries[0]).toMatchObject({
      key: { ruleId: "transfer-1", budgetId: "budget-1", month },
      state: "claimed",
      claimedAt: "2026-07-01T00:00:00.000Z",
      operation: { updates: [{ categoryId: "source" }, { categoryId: "destination" }] },
    });
  });

  it("preserves category display names from persisted generic operation claims", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl");
    const month = parseBudgetMonth("2026-07");
    const claim = genericClaim({ ruleId: "transfer-1", budgetId: "budget-1", month });
    await writeFile(
      path,
      `${JSON.stringify({
        ...claim,
        operation: {
          ...claim.operation,
          updates: claim.operation.updates.map((update) =>
            update.categoryId === "source" ? { ...update, categoryName: "Savings" } : update,
          ),
        },
      })}\n`,
      "utf8",
    );
    const log = new JsonlTopUpAuditLog(path);

    const scan = await log.scanOperationAuditEntries({ ruleId: "transfer-1", budgetId: "budget-1", month });

    expect(scan.entries[0]?.operation?.updates[0]).toMatchObject({ categoryId: "source", categoryName: "Savings" });
  });

  it("groups audit records so applied wins over claimed while keeping claim details", async () => {
    const log = new JsonlTopUpAuditLog(join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl"));
    const month = parseBudgetMonth("2026-07");

    await log.append(
      genericClaim({ ruleId: "transfer-1", budgetId: "budget-1", month, claimedAt: "2026-07-01T00:00:00.000Z" }),
    );
    await log.append({
      kind: "budget-operation-applied",
      ruleId: "transfer-1",
      ruleType: "category-available-transfer",
      budgetId: "budget-1",
      month,
      appliedAt: "2026-07-01T00:00:01.000Z",
    });

    const scan = await log.scanOperationAuditEntries({ ruleId: "transfer-1", budgetId: "budget-1", month });

    expect(scan.entries).toMatchObject([
      {
        state: "applied",
        claimedAt: "2026-07-01T00:00:00.000Z",
        appliedAt: "2026-07-01T00:00:01.000Z",
        operation: { summary: "move $50.00 from source to destination" },
      },
    ]);
  });

  it("scans legacy top-up records with limited detail", async () => {
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

    const scan = await log.scanOperationAuditEntries({ state: "claimed" });

    expect(scan.entries).toMatchObject([
      {
        state: "claimed",
        ruleType: "monthly-category-top-up",
        legacyTopUp: { categoryId: "category-1", assignmentAmount: 50_000, budgetedAfter: 75_000 },
      },
    ]);
  });

  it("counts ignored audit lines during scans", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ynab-audit-")), "audit.jsonl");
    const month = parseBudgetMonth("2026-07");
    await writeFile(
      path,
      [
        `not-json`,
        JSON.stringify({ kind: "wrong" }),
        JSON.stringify(genericClaim({ ruleId: "transfer-1", budgetId: "budget-1", month })),
      ].join("\n"),
      "utf8",
    );
    const log = new JsonlTopUpAuditLog(path);

    const scan = await log.scanOperationAuditEntries();

    expect(scan.ignoredLineCount).toBe(2);
    expect(scan.entries).toHaveLength(1);
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

function genericClaim(input: {
  readonly ruleId: string;
  readonly budgetId: string;
  readonly month: ReturnType<typeof parseBudgetMonth>;
  readonly claimedAt?: string;
}) {
  return {
    kind: "budget-operation-claimed" as const,
    ruleId: input.ruleId,
    ruleType: "category-available-transfer" as const,
    budgetId: input.budgetId,
    month: input.month,
    operation: {
      ruleId: input.ruleId,
      ruleType: "category-available-transfer" as const,
      budgetId: input.budgetId,
      month: input.month,
      summary: "move $50.00 from source to destination",
      reason: "transfer-needed",
      updates: [
        {
          categoryId: "source",
          budgetedBefore: milliunits(100_000),
          budgetedAfter: milliunits(50_000),
          delta: milliunits(-50_000),
          role: "source" as const,
        },
        {
          categoryId: "destination",
          budgetedBefore: milliunits(10_000),
          budgetedAfter: milliunits(60_000),
          delta: milliunits(50_000),
          role: "destination" as const,
        },
      ],
    },
    claimedAt: input.claimedAt ?? "2026-07-01T00:00:00.000Z",
  };
}
