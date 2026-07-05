import { z } from "zod";

export type AppEnv = {
  readonly ynabAccessToken: string;
  readonly rulesFile: string;
  readonly auditLogFile: string;
};

const envSchema = z.object({
  YNAB_ACCESS_TOKEN: z.string().min(1),
  YNAB_RULES_FILE: z.string().min(1).default("config/rules.json"),
  YNAB_AUDIT_LOG_FILE: z.string().min(1).default("data/audit-log.jsonl")
});

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(input);

  return {
    ynabAccessToken: parsed.YNAB_ACCESS_TOKEN,
    rulesFile: parsed.YNAB_RULES_FILE,
    auditLogFile: parsed.YNAB_AUDIT_LOG_FILE
  };
}
