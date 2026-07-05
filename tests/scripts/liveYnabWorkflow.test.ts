import { describe, expect, it, vi } from "vitest";
import { parseBudgetMonth } from "../../src/domain/month.js";
import { milliunits } from "../../src/domain/money.js";
import type { BudgetClient, CategoryListItem } from "../../src/ynab/budgetClient.js";
import {
  assertCategoryMonthSnapshot,
  expectCategoryMonth,
  parseLiveYnabWorkflowEnv,
  redactLiveWorkflowOutput,
} from "../../scripts/liveYnabWorkflow.js";

describe("live YNAB workflow env parsing", () => {
  it("requires an explicit mutation opt-in", () => {
    expect(() => parseLiveYnabWorkflowEnv({})).toThrow(
      "YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS=true is required because this live workflow mutates a YNAB budget",
    );
  });

  it("requires a YNAB access token after mutation opt-in", () => {
    expect(() => parseLiveYnabWorkflowEnv({ YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS: "true" })).toThrow(
      "YNAB_ACCESS_TOKEN must be set before running the live workflow",
    );
  });

  it("requires an isolated test budget ID", () => {
    expect(() =>
      parseLiveYnabWorkflowEnv({ YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS: "true", YNAB_ACCESS_TOKEN: "token" }),
    ).toThrow("YNAB_LIVE_WORKFLOW_BUDGET_ID must be set to an isolated YNAB test budget ID");
  });

  it("parses required env and defaults the month", () => {
    expect(
      parseLiveYnabWorkflowEnv(
        {
          YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS: "true",
          YNAB_ACCESS_TOKEN: "token",
          YNAB_LIVE_WORKFLOW_BUDGET_ID: "budget-1",
        },
        { getCurrentBudgetMonth: () => parseBudgetMonth("2026-07") },
      ),
    ).toEqual({ accessToken: "token", budgetId: "budget-1", month: "2026-07", verboseLogs: false });
  });

  it("parses an explicit workflow month", () => {
    expect(
      parseLiveYnabWorkflowEnv({
        YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS: "true",
        YNAB_ACCESS_TOKEN: "token",
        YNAB_LIVE_WORKFLOW_BUDGET_ID: "budget-1",
        YNAB_LIVE_WORKFLOW_MONTH: "2026-08",
      }),
    ).toMatchObject({ month: "2026-08" });
  });

  it("parses the explicit verbose logging opt-in", () => {
    expect(
      parseLiveYnabWorkflowEnv({
        YNAB_ALLOW_LIVE_WORKFLOW_MUTATIONS: "true",
        YNAB_ACCESS_TOKEN: "token",
        YNAB_LIVE_WORKFLOW_BUDGET_ID: "budget-1",
        YNAB_LIVE_WORKFLOW_VERBOSE: "true",
      }),
    ).toMatchObject({ verboseLogs: true });
  });
});

describe("live YNAB workflow log redaction", () => {
  it("redacts IDs and dollar amounts from workflow output", () => {
    expect(
      redactLiveWorkflowOutput(
        "Budget 6d023b68-0e92-49f7-a1d4-c42c433acd86 category 2ec1b1c1-6f14-46ae-99e2-4cbdb5183031 moved $10.00 and -$3.00",
      ),
    ).toBe("Budget <id-redacted> category <id-redacted> moved $<amount-redacted> and $<amount-redacted>");
  });
});

describe("live YNAB workflow category snapshot assertions", () => {
  const month = parseBudgetMonth("2026-07");
  const category: CategoryListItem = {
    id: "category-1",
    name: "Transfer Source",
    categoryGroupId: "group-1",
    categoryGroupName: "Automation Test",
    hidden: false,
  };

  it("verifies the full category month snapshot, including balance used by rule planning", async () => {
    const getCategoryMonth = vi.fn(async () => ({
      budgeted: milliunits(10_000),
      activity: milliunits(0),
      balance: milliunits(10_000),
    }));
    const budgetClient = {
      getCategoryMonth,
      updateCategoryBudgeted: vi.fn(),
    } satisfies BudgetClient;

    await expect(
      expectCategoryMonth({
        budgetClient,
        budgetId: "budget-1",
        month,
        category,
        snapshot: { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(10_000) },
      }),
    ).resolves.toBeUndefined();

    expect(getCategoryMonth).toHaveBeenCalledWith({ budgetId: "budget-1", month, categoryId: "category-1" });
  });

  it("fails when budgeted is unchanged but balance does not match the rule-planning precondition", () => {
    expect(() =>
      assertCategoryMonthSnapshot(
        "Transfer Source",
        { budgeted: milliunits(10_000), activity: milliunits(-1_000), balance: milliunits(9_000) },
        { budgeted: milliunits(10_000), activity: milliunits(0), balance: milliunits(10_000) },
      ),
    ).toThrow(
      "Expected Transfer Source snapshot to be budgeted=$10.00, activity=$0.00, balance=$10.00; received budgeted=$10.00, activity=-$1.00, balance=$9.00",
    );
  });
});
