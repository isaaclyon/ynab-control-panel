import {
  JsonlBudgetOperationAuditLog,
  type OperationAuditEntry,
  type OperationAuditEntryFilter,
  type OperationAuditKey,
  type OperationAuditScan,
} from "../audit/auditLog.js";
import type { AuditEnv } from "../config/env.js";
import type { CategoryBudgetUpdate } from "../domain/budgetOperation.js";
import { parseBudgetMonth } from "../domain/month.js";
import { formatMilliunits, type Milliunits } from "../domain/money.js";

export type AuditStatusOptions = {
  readonly month?: string;
  readonly budget?: string;
  readonly rule?: string;
  readonly auditLog?: string;
  readonly json?: boolean;
};

export type AuditInspectOptions = {
  readonly month: string;
  readonly budget: string;
  readonly rule: string;
  readonly auditLog?: string;
  readonly json?: boolean;
};

type AuditLogReader = {
  scanOperationAuditEntries(filter?: OperationAuditEntryFilter): Promise<OperationAuditScan>;
};

type AuditCommandDependencies = {
  readonly createAuditLogReader: (path: string) => AuditLogReader;
};

const defaultDependencies: AuditCommandDependencies = {
  createAuditLogReader: (path) => new JsonlBudgetOperationAuditLog(path),
};

export async function auditStatusCommand(input: {
  readonly env: AuditEnv;
  readonly options: AuditStatusOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<AuditCommandDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const reader = dependencies.createAuditLogReader(input.options.auditLog ?? input.env.auditLogFile);
  const scan = await reader.scanOperationAuditEntries(statusFilter(input.options));

  (input.stdout ?? process.stdout).write(
    `${input.options.json ? formatAuditStatusJson(scan) : formatAuditStatus(scan)}\n`,
  );
  writeIgnoredLineWarning(input.stderr ?? process.stderr, scan.ignoredLineCount);
}

export async function auditInspectCommand(input: {
  readonly env: AuditEnv;
  readonly options: AuditInspectOptions;
  readonly stdout?: Pick<NodeJS.WriteStream, "write">;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
  readonly dependencies?: Partial<AuditCommandDependencies>;
}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const key = parseInspectKey(input.options);
  const reader = dependencies.createAuditLogReader(input.options.auditLog ?? input.env.auditLogFile);
  const scan = await reader.scanOperationAuditEntries(key);
  const entry = scan.entries[0];

  const output = input.options.json
    ? formatAuditInspectJson({ key, entry, ignoredLineCount: scan.ignoredLineCount })
    : formatAuditInspect({ key, entry, ignoredLineCount: scan.ignoredLineCount });

  (input.stdout ?? process.stdout).write(`${output}\n`);
  writeIgnoredLineWarning(input.stderr ?? process.stderr, scan.ignoredLineCount);
}

export function formatAuditStatus(scan: OperationAuditScan): string {
  return scan.entries.length === 0
    ? "No pending recovery operations found."
    : scan.entries.map((entry) => formatAuditEntry(entry)).join("\n\n");
}

export function formatAuditStatusJson(scan: OperationAuditScan): string {
  return JSON.stringify(scan, null, 2);
}

export function formatAuditInspect(input: {
  readonly key: OperationAuditKey;
  readonly entry: OperationAuditEntry | undefined;
  readonly ignoredLineCount: number;
}): string {
  if (!input.entry) {
    return [
      `none: ${input.key.ruleId}`,
      `  budgetId: ${input.key.budgetId}`,
      `  month: ${input.key.month}`,
      "  no audit records found for this budget/rule/month",
    ].join("\n");
  }

  return formatAuditEntry(input.entry);
}

export function formatAuditInspectJson(input: {
  readonly key: OperationAuditKey;
  readonly entry: OperationAuditEntry | undefined;
  readonly ignoredLineCount: number;
}): string {
  return JSON.stringify({ ...input, entry: input.entry ?? null }, null, 2);
}

function formatAuditEntry(entry: OperationAuditEntry): string {
  return [
    `${formatState(entry.state)}: ${entry.key.ruleId}${entry.ruleType ? ` (${entry.ruleType})` : ""}`,
    `  budgetId: ${entry.key.budgetId}`,
    `  month: ${entry.key.month}`,
    ...formatTimestamps(entry),
    ...formatOperationDetails(entry),
  ].join("\n");
}

function formatTimestamps(entry: OperationAuditEntry): string[] {
  return [
    entry.claimedAt ? `  claimedAt: ${entry.claimedAt}` : undefined,
    entry.appliedAt ? `  appliedAt: ${entry.appliedAt}` : undefined,
  ].filter((line): line is string => line !== undefined);
}

function formatOperationDetails(entry: OperationAuditEntry): string[] {
  if (entry.operation) {
    return [
      ...formatDescriptionLines(entry.operation.description),
      `  ${entry.operation.summary}`,
      `  reason: ${entry.operation.reason}`,
      ...entry.operation.updates.map(
        (update) =>
          `  ${update.role ? `${update.role} ` : ""}${formatCategoryReference(update)} budgeted: ${formatMilliunits(update.budgetedBefore)} -> ${formatMilliunits(update.budgetedAfter)} (${formatDelta(update.delta)})`,
      ),
    ];
  }

  if (entry.legacyTopUp) {
    return [
      "  legacy monthly-category-top-up audit record; full planned operation details are unavailable",
      `  category: ${entry.legacyTopUp.categoryId}`,
      `  assignment: ${formatMilliunits(entry.legacyTopUp.assignmentAmount)}`,
      `  budgetedAfter: ${formatMilliunits(entry.legacyTopUp.budgetedAfter)}`,
    ];
  }

  return ["  operation detail unavailable; no matching claim payload was found"];
}

function formatDescriptionLines(description: string | undefined): string[] {
  return description ? [`  description: ${formatDisplayText(description)}`] : [];
}

function formatState(state: OperationAuditEntry["state"]): string {
  return state === "claimed" ? "pending-recovery" : "applied";
}

function formatDelta(delta: Milliunits): string {
  if (delta > 0) {
    return `+${formatMilliunits(delta)}`;
  }

  return formatMilliunits(delta);
}

function formatCategoryReference(update: CategoryBudgetUpdate): string {
  return update.categoryName ? `${update.categoryId} (${formatCategoryName(update.categoryName)})` : update.categoryId;
}

function formatCategoryName(name: string): string {
  return formatDisplayText(name);
}

function formatDisplayText(value: string): string {
  return value.replace(/[\t\n\r]+/g, " ");
}

export function formatIgnoredLineWarning(ignoredLineCount: number): string | undefined {
  if (ignoredLineCount === 0) {
    return undefined;
  }

  const lineNoun = ignoredLineCount === 1 ? "line" : "lines";
  const verb = ignoredLineCount === 1 ? "was" : "were";
  return `Warning: ${ignoredLineCount} audit log ${lineNoun} could not be parsed and ${verb} ignored.`;
}

function writeIgnoredLineWarning(stderr: Pick<NodeJS.WriteStream, "write">, ignoredLineCount: number): void {
  const warning = formatIgnoredLineWarning(ignoredLineCount);
  if (warning) {
    stderr.write(`${warning}\n`);
  }
}

function statusFilter(options: AuditStatusOptions): OperationAuditEntryFilter {
  return {
    state: "claimed",
    ...(options.month ? { month: parseBudgetMonth(options.month) } : {}),
    ...(options.budget ? { budgetId: options.budget } : {}),
    ...(options.rule ? { ruleId: options.rule } : {}),
  };
}

function parseInspectKey(options: AuditInspectOptions): OperationAuditKey {
  return {
    ruleId: options.rule,
    budgetId: options.budget,
    month: parseBudgetMonth(options.month),
  };
}
