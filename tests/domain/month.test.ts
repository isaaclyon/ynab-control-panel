import { describe, expect, it } from "vitest";
import { budgetMonthSchema, currentBudgetMonth, nextBudgetMonth, parseBudgetMonth } from "../../src/domain/month.js";

describe("budget month parsing", () => {
  it("parses YYYY-MM months", () => {
    expect(parseBudgetMonth("2026-07")).toBe("2026-07");
  });

  it("rejects invalid formats and impossible month numbers", () => {
    expect(() => parseBudgetMonth("2026-7")).toThrow("YYYY-MM");
    expect(() => parseBudgetMonth("2026-13")).toThrow("between 01 and 12");
  });

  it("uses UTC for the current budget month", () => {
    expect(currentBudgetMonth(new Date("2026-07-31T23:00:00.000Z"))).toBe("2026-07");
  });

  it("finds the next budget month across year boundaries", () => {
    expect(nextBudgetMonth(parseBudgetMonth("2026-07"))).toBe("2026-08");
    expect(nextBudgetMonth(parseBudgetMonth("2026-12"))).toBe("2027-01");
  });

  it("parses months through the external-boundary schema", () => {
    expect(budgetMonthSchema.safeParse("2026-07")).toMatchObject({ success: true, data: "2026-07" });
    expect(budgetMonthSchema.safeParse("2026-13")).toMatchObject({ success: false });
  });
});
