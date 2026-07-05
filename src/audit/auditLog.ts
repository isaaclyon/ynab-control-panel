import { appendFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { BudgetMonth } from "../domain/month.js";
import { milliunits, type Milliunits } from "../domain/money.js";

export type TopUpAuditRecord = ClaimedTopUpRecord | AppliedTopUpRecord;

export type ClaimedTopUpRecord = {
  readonly kind: "monthly-category-top-up-claimed";
  readonly ruleId: string;
  readonly budgetId: string;
  readonly categoryId: string;
  readonly month: BudgetMonth;
  readonly assignmentAmount: Milliunits;
  readonly budgetedAfter: Milliunits;
  readonly claimedAt: string;
};

export type AppliedTopUpRecord = {
  readonly kind: "monthly-category-top-up-applied";
  readonly ruleId: string;
  readonly budgetId: string;
  readonly categoryId: string;
  readonly month: BudgetMonth;
  readonly assignmentAmount: Milliunits;
  readonly budgetedAfter: Milliunits;
  readonly appliedAt: string;
};

export interface TopUpAuditLog {
  hasClaimedOrApplied(ruleId: string, month: BudgetMonth): Promise<boolean>;
  append(record: TopUpAuditRecord): Promise<void>;
  runExclusive<T>(ruleId: string, month: BudgetMonth, operation: () => Promise<T>): Promise<T>;
}

export class JsonlTopUpAuditLog implements TopUpAuditLog {
  public constructor(private readonly path: string) {}

  public async runExclusive<T>(ruleId: string, month: BudgetMonth, operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.${lockKey(ruleId, month)}.lock`;
    const handle = await acquireLock(lockPath);

    try {
      return await operation();
    } finally {
      await handle.close();
      await rm(lockPath, { force: true });
    }
  }

  public async hasClaimedOrApplied(ruleId: string, month: BudgetMonth): Promise<boolean> {
    const records = await this.readRecords();

    return records.some((record) => record.ruleId === ruleId && record.month === month);
  }

  public async append(record: TopUpAuditRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  private async readRecords(): Promise<TopUpAuditRecord[]> {
    const raw = await this.readRaw();

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => parseRecordLine(line));
  }

  private async readRaw(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return "";
      }

      /* v8 ignore next */
      throw error;
    }
  }
}

async function acquireLock(path: string) {
  const deadline = Date.now() + 10_000;

  while (true) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, "utf8");
      return handle;
    } catch (error) {
      /* v8 ignore next 3 */
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      await removeStaleLock(path);

      /* v8 ignore next 3 */
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for audit lock ${path}`);
      }

      await setTimeout(25);
    }
  }
}

async function removeStaleLock(path: string): Promise<void> {
  const staleAfterMs = 10 * 60 * 1_000;

  try {
    const details = await stat(path);
    if (Date.now() - details.mtimeMs > staleAfterMs) {
      await rm(path, { force: true });
    }
  } catch (error) {
    /* v8 ignore next 3 */
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function lockKey(ruleId: string, month: BudgetMonth): string {
  return `${ruleId}-${month}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function parseRecordLine(line: string): TopUpAuditRecord[] {
  try {
    const parsed: unknown = JSON.parse(line);
    return isTopUpAuditRecord(parsed) ? [normalizeRecord(parsed)] : [];
  } catch {
    return [];
  }
}

function normalizeRecord(record: TopUpAuditRecord): TopUpAuditRecord {
  return {
    ...record,
    assignmentAmount: milliunits(record.assignmentAmount),
    budgetedAfter: milliunits(record.budgetedAfter)
  };
}

function isTopUpAuditRecord(input: unknown): input is TopUpAuditRecord {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  const hasCommonFields =
    typeof candidate.ruleId === "string" &&
    typeof candidate.budgetId === "string" &&
    typeof candidate.categoryId === "string" &&
    typeof candidate.month === "string" &&
    typeof candidate.assignmentAmount === "number" &&
    typeof candidate.budgetedAfter === "number";

  return (
    hasCommonFields &&
    ((candidate.kind === "monthly-category-top-up-claimed" && typeof candidate.claimedAt === "string") ||
      (candidate.kind === "monthly-category-top-up-applied" && typeof candidate.appliedAt === "string"))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
