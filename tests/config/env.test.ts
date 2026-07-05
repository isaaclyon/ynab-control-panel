import { describe, expect, it } from "vitest";
import { parseAuditEnv, parseEnv, parseRulesEnv } from "../../src/config/env.js";

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

  it("parses audit-only env without requiring a YNAB access token", () => {
    expect(parseAuditEnv({})).toEqual({ auditLogFile: "data/audit-log.jsonl" });
    expect(parseAuditEnv({ YNAB_AUDIT_LOG_FILE: "custom-audit.jsonl" })).toEqual({
      auditLogFile: "custom-audit.jsonl",
    });
  });

  it("parses rules-only env without requiring a YNAB access token", () => {
    expect(parseRulesEnv({})).toEqual({ rulesFile: "config/rules.json" });
    expect(parseRulesEnv({ YNAB_RULES_FILE: "custom-rules.json" })).toEqual({ rulesFile: "custom-rules.json" });
  });
});
