import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

describe("env parsing", () => {
  it("parses required secrets and default file locations", () => {
    expect(parseEnv({ YNAB_ACCESS_TOKEN: "token" })).toEqual({
      ynabAccessToken: "token",
      rulesFile: "config/rules.json",
      auditLogFile: "data/audit-log.jsonl",
    });
  });

  it("rejects missing access tokens at the environment boundary", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
