import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

function auditPath(): string {
  const dir = process.env["METAPILOT_LOGS_DIR"] ?? "logs";
  return join(dir, "audit.jsonl");
}

export type AuditEntry = {
  started_at: string;
  completed_at: string;
  duration_ms: number;
  command: readonly string[];
  mutating: boolean;
  status: "ok" | "failed";
  exit_code: number;
  note?: string;
};

export async function appendAudit(entry: AuditEntry): Promise<void> {
  const path = auditPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
}
