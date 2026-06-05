import { isWriteKind, type WriteKind } from "../writes.ts";

export class UsageError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "UsageError";
  }
}

const BOOL_FLAGS = new Set([
  "--yes",
  "--confirm-activate",
  "--confirm-large-budget",
  "--first-budget",
]);

export type ParsedArgs = {
  flags: Map<string, string | true>;
  positional: string[];
};

/**
 * Parse argv. Supports `--key=value`, `--key value`, and bare booleans (only
 * for keys in BOOL_FLAGS). Throws UsageError for unknown flags missing a value
 * (e.g. `--since` with no following arg, or `--since --yes` where the next
 * token is another flag) — silent fallthrough to boolean true was a footgun.
 */
export function parseArgs(args: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        flags.set(a.slice(0, eq), a.slice(eq + 1));
        continue;
      }
      if (BOOL_FLAGS.has(a)) {
        flags.set(a, true);
        continue;
      }
      // Value-flag form: must be followed by a non-flag token.
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`flag ${a} requires a value`);
      }
      flags.set(a, next);
      i++;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export function strFlag(
  flags: Map<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

export function splitCsv(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

export function usdToCents(usd: string): number {
  const n = parseFloat(usd);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`invalid USD amount: ${usd}`);
  }
  return Math.round(n * 100);
}

export function parseKindId(
  parsed: ParsedArgs,
  action: string,
): { kind: WriteKind; id: string; flags: Map<string, string | true> } {
  const [kindArg, id] = parsed.positional;
  if (!kindArg || !id) {
    throw new UsageError(
      `usage: metapilot ${action} <campaign|adset|ad> <id> [--yes${action === "resume" ? " --confirm-activate" : ""}]`,
    );
  }
  if (!isWriteKind(kindArg)) {
    throw new UsageError(`invalid kind: ${kindArg} (must be campaign|adset|ad)`);
  }
  return { kind: kindArg, id, flags: parsed.flags };
}

export function emitPreview(preview: unknown): void {
  process.stdout.write(JSON.stringify({ preview }, null, 2) + "\n");
}

export function writeMetaResult(r: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): number {
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.exitCode;
}

/**
 * Refuse to proceed if AD_ACCOUNT_ID env var is unset. Called by every
 * `ads`-scoped command before spawning `meta`, so the user gets a single
 * actionable message instead of N copies of meta CLI's stock error.
 *
 * Phase 1: single-account assumption — multi-account support is Phase 2
 * (spec §10).
 */
export function requireAdAccount(): void {
  if (!process.env["AD_ACCOUNT_ID"]) {
    throw new UsageError(
      "AD_ACCOUNT_ID env var is not set. Run `metapilot accounts` to list accessible accounts, then `export AD_ACCOUNT_ID=act_…`.",
    );
  }
}
