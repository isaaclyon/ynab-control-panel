import { z } from "zod";

export type Milliunits = number & { readonly __brand: "Milliunits" };

const dollarsPattern = /^-?\d+(\.\d{1,3})?$/;

export function milliunits(value: number): Milliunits {
  if (!Number.isInteger(value)) {
    throw new Error(`Milliunits must be an integer, received ${value}`);
  }

  return value as Milliunits;
}

export function parseDollarAmount(input: string): Milliunits {
  if (!dollarsPattern.test(input)) {
    throw new Error(`Dollar amount must use up to three decimal places, received ${input}`);
  }

  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const paddedFraction = fraction.padEnd(3, "0");
  const parsed = Number.parseInt(whole, 10) * 1_000 + Number.parseInt(paddedFraction, 10);

  return milliunits(negative ? -parsed : parsed);
}

export const dollarAmountSchema = z.string().transform((value, context) => {
  try {
    return parseDollarAmount(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid dollar amount",
    });

    return z.NEVER;
  }
});

export function formatMilliunits(value: Milliunits): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const dollars = Math.floor(absolute / 1_000);
  const cents = Math.round((absolute % 1_000) / 10);

  return `${sign}$${dollars}.${cents.toString().padStart(2, "0")}`;
}
