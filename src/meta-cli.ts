import { appendAudit } from "./audit.ts";
import { claimWriteSlot, type WriteCheckOptions } from "./safety.ts";

const SUBPROCESS_TIMEOUT_MS = 60_000;

export type MetaCallOptions = WriteCheckOptions & {
  mutating: boolean;
};

export type MetaResult<T = unknown> = {
  exitCode: number;
  stdout: string;
  stderr: string;
  parsed: T | null;
  timedOut: boolean;
};

// Meta CLI sometimes returns a bare JSON array, sometimes `{data: [...]}`.
// Normalize both shapes; treat anything else as empty.
export function unwrapArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    return (v as { data: T[] }).data;
  }
  return [];
}

const BIN = "meta";
// Top-level options on the `meta` binary — must come BEFORE the subcommand chain.
const GLOBAL_FLAGS = ["--output", "json", "--no-input"] as const;

/**
 * Run a `meta` CLI subcommand. Callers pass the full subcommand chain
 * (e.g. ["auth", "status"] or ["ads", "campaign", "list"]); this function
 * prepends the JSON/no-input global flags and handles audit + safety gating.
 *
 * Account selection: the real `meta` CLI reads AD_ACCOUNT_ID from env, so we
 * just inherit env via Bun.spawn defaults.
 */
export async function runMeta<T = unknown>(
  subcommand: readonly string[],
  opts: MetaCallOptions,
): Promise<MetaResult<T>> {
  if (opts.mutating) {
    await claimWriteSlot(opts);
  }

  const fullArgs = [...GLOBAL_FLAGS, ...subcommand];
  const command: readonly string[] = [BIN, ...fullArgs];
  const startedAt = new Date();
  const startMs = startedAt.getTime();

  const proc = Bun.spawn([BIN, ...fullArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    try { proc.kill(); } catch { /* ignore */ }
  }, SUBPROCESS_TIMEOUT_MS);

  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  let timedOut = false;
  try {
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    exitCode = await proc.exited;
    timedOut = Date.now() - startMs >= SUBPROCESS_TIMEOUT_MS && exitCode !== 0;
  } finally {
    clearTimeout(timeout);
  }

  await appendAudit({
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startMs,
    command,
    mutating: opts.mutating,
    status: exitCode === 0 ? "ok" : "failed",
    exit_code: exitCode,
    ...(timedOut ? { note: `timeout after ${SUBPROCESS_TIMEOUT_MS}ms` } : {}),
  });

  let parsed: T | null = null;
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed) as T;
    } catch {
      parsed = null;
    }
  }

  return { exitCode, stdout, stderr, parsed, timedOut };
}
