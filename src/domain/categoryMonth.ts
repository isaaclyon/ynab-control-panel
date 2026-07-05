import type { Milliunits } from "./money.js";

export type CategoryMonthSnapshot = {
  readonly budgeted: Milliunits;
  readonly activity: Milliunits;
  readonly balance: Milliunits;
};
