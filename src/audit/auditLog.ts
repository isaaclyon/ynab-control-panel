import { appendFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { PlannedBudgetOperation } from "../domain/budgetOperation.js";
import type { BudgetMonth } from "../domain/month.js";
import { milliunits, type Milliunits } from "../domain/money.js";

export type OperationAuditState = "none" | "claimed" | "applied";

export type BudgetOperationAuditRecord =
  | ClaimedBudgetOperationRecord
  | AppliedBudgetOperationRecord
  | ClaimedTopUpRecord
  | AppliedTopUpRecord;

export type ClaimedBudgetOperationRecord = {
  readonly kind: "budget-operation-claimed";
  readonly ruleId: string;
  readonly ruleType: PlannedBudgetOperation["ruleType"];
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly operation: PlannedBudgetOperation;
  readonly claimedAt: string;
};

export type AppliedBudgetOperationRecord = {
  readonly kind: "budget-operation-applied";
  readonly ruleId: string;
  readonly ruleType: PlannedBudgetOperation["ruleType"];
  readonly budgetId: string;
  readonly month: BudgetMonth;
  readonly appliedAt: string;
};

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

export type OperationAuditKey = {
  readonly ruleId: string;
  readonly budgetId: string;
  readonly month: BudgetMonth;
};

export interface BudgetOperationAuditLog {
  getOperationState(key: OperationAuditKey): Promise<OperationAuditState>;
  append(record: BudgetOperationAuditRecord): Promise<void>;
  runExclusive<T>(ruleId: string, month: BudgetMonth, operation: () => Promise<T>): Promise<T>;
}

export interface TopUpAuditLog extends BudgetOperationAuditLog {
  hasClaimedOrApplied(ruleId: string, month: BudgetMonth): Promise<boolean>;
}

export class JsonlBudgetOperationAuditLog implements TopUpAuditLog {
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

  public async getOperationState(key: OperationAuditKey): Promise<OperationAuditState> {
    const records = await this.readRecords();
    const matches = records.filter(
      (record) => record.ruleId === key.ruleId && record.budgetId === key.budgetId && record.month === key.month,
    );

    if (matches.some((record) => isAppliedRecord(record))) {
      return "applied";
    }

    if (matches.some((record) => isClaimedRecord(record))) {
      return "claimed";
    }

    return "none";
  }

  public async hasClaimedOrApplied(ruleId: string, month: BudgetMonth): Promise<boolean> {
    const records = await this.readRecords();

    return records.some((record) => record.ruleId === ruleId && record.month === month);
  }

  public async append(record: BudgetOperationAuditRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  private async readRecords(): Promise<BudgetOperationAuditRecord[]> {
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

export const JsonlTopUpAuditLog = JsonlBudgetOperationAuditLog;

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

function parseRecordLine(line: string): BudgetOperationAuditRecord[] {
  try {
    const parsed: unknown = JSON.parse(line);

    if (isBudgetOperationAuditRecord(parsed)) {
      return [normalizeBudgetOperationRecord(parsed)];
    }

    if (isTopUpAuditRecord(parsed)) {
      return [normalizeTopUpRecord(parsed)];
    }

    return [];
  } catch {
    return [];
  }
}

function normalizeBudgetOperationRecord(record: ClaimedBudgetOperationRecord | AppliedBudgetOperationRecord) {
  if (record.kind === "budget-operation-applied") {
    return record;
  }

  return {
    ...record,
    operation: {
      ...record.operation,
      updates: record.operation.updates.map((update) => ({
        ...update,
        budgetedBefore: milliunits(update.budgetedBefore),
        budgetedAfter: milliunits(update.budgetedAfter),
        delta: milliunits(update.delta),
      })),
    },
  };
}

function normalizeTopUpRecord(record: TopUpAuditRecord): TopUpAuditRecord {
  return {
    ...record,
    assignmentAmount: milliunits(record.assignmentAmount),
    budgetedAfter: milliunits(record.budgetedAfter),
  };
}

function isBudgetOperationAuditRecord(
  input: unknown,
): input is ClaimedBudgetOperationRecord | AppliedBudgetOperationRecord {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  const hasCommonFields =
    typeof candidate["ruleId"] === "string" &&
    typeof candidate["ruleType"] === "string" &&
    typeof candidate["budgetId"] === "string" &&
    typeof candidate["month"] === "string";

  return (
    hasCommonFields &&
    ((candidate["kind"] === "budget-operation-claimed" &&
      typeof candidate["claimedAt"] === "string" &&
      isPlannedBudgetOperation(candidate["operation"])) ||
      (candidate["kind"] === "budget-operation-applied" && typeof candidate["appliedAt"] === "string"))
  );
}

function isPlannedBudgetOperation(input: unknown): input is PlannedBudgetOperation {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate["ruleId"] === "string" &&
    typeof candidate["ruleType"] === "string" &&
    typeof candidate["budgetId"] === "string" &&
    typeof candidate["month"] === "string" &&
    typeof candidate["summary"] === "string" &&
    typeof candidate["reason"] === "string" &&
    Array.isArray(candidate["updates"]) &&
    candidate["updates"].every(isCategoryBudgetUpdate)
  );
}

function isCategoryBudgetUpdate(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate["categoryId"] === "string" &&
    typeof candidate["budgetedBefore"] === "number" &&
    typeof candidate["budgetedAfter"] === "number" &&
    typeof candidate["delta"] === "number"
  );
}

function isTopUpAuditRecord(input: unknown): input is TopUpAuditRecord {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  const hasCommonFields =
    typeof candidate["ruleId"] === "string" &&
    typeof candidate["budgetId"] === "string" &&
    typeof candidate["categoryId"] === "string" &&
    typeof candidate["month"] === "string" &&
    typeof candidate["assignmentAmount"] === "number" &&
    typeof candidate["budgetedAfter"] === "number";

  return (
    hasCommonFields &&
    ((candidate["kind"] === "monthly-category-top-up-claimed" && typeof candidate["claimedAt"] === "string") ||
      (candidate["kind"] === "monthly-category-top-up-applied" && typeof candidate["appliedAt"] === "string"))
  );
}

function isAppliedRecord(record: BudgetOperationAuditRecord): boolean {
  return record.kind === "budget-operation-applied" || record.kind === "monthly-category-top-up-applied";
}

function isClaimedRecord(record: BudgetOperationAuditRecord): boolean {
  return record.kind === "budget-operation-claimed" || record.kind === "monthly-category-top-up-claimed";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
