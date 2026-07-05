import { describe, expect, it } from "vitest";
import { dollarAmountSchema, formatMilliunits, milliunits, parseDollarAmount } from "../../src/domain/money.js";

const amountCases: Array<[string, number, string]> = [
  ["0", 0, "$0.00"],
  ["12", 12_000, "$12.00"],
  ["12.34", 12_340, "$12.34"],
  ["12.345", 12_345, "$12.35"],
  ["-1.23", -1_230, "-$1.23"],
];

describe("money parsing", () => {
  it.each(amountCases)("parses %s into YNAB milliunits", (input, expected, formatted) => {
    const parsed = parseDollarAmount(input);

    expect(parsed).toBe(expected);
    expect(formatMilliunits(parsed)).toBe(formatted);
  });

  it("rejects non-integer milliunits", () => {
    expect(() => milliunits(1.5)).toThrow("Milliunits must be an integer");
  });

  it("rejects dollar amounts that cannot be parsed exactly to milliunits", () => {
    expect(() => parseDollarAmount("1.2345")).toThrow("Dollar amount must use up to three decimal places");
  });

  it("parses dollar amounts through the external-boundary schema", () => {
    expect(dollarAmountSchema.safeParse("10.00")).toMatchObject({ success: true, data: 10_000 });
    expect(dollarAmountSchema.safeParse("not-money")).toMatchObject({ success: false });
  });
});
