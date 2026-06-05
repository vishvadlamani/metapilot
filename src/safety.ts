import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_WRITES_PER_HOUR = 10;
const COOLDOWN_MS = 5_000;
const BUDGET_DOUBLE_CONFIRM_MULTIPLIER = 2;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Stale-lock recovery: if a lockfile is older than this, take it.
const STALE_LOCK_MS = 2_000;
const LOCK_POLL_MS = 25;
const LOCK_MAX_WAIT_MS = 5_000;

function logsDir(): string {
  return process.env["METAPILOT_LOGS_DIR"] ?? "logs";
}
function statePath(): string {
  return join(logsDir(), ".safety-state.json");
}
function lockPath(): string {
  return join(logsDir(), ".safety-state.lock");
}

type State = { writes: number[] };

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyError";
  }
}

export type WriteCheckOptions = {
  budgetCents?: number;
  previousBudgetCents?: number;
  largeBudgetConfirmed?: boolean;
  firstBudgetConfirmed?: boolean;
  activation?: boolean;
  activationConfirmed?: boolean;
};

async function loadState(): Promise<State> {
  try {
    const text = await readFile(statePath(), "utf8");
    const parsed = JSON.parse(text) as Partial<State>;
    return { writes: Array.isArray(parsed.writes) ? parsed.writes : [] };
  } catch {
    return { writes: [] };
  }
}

async function saveState(s: State): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true });
  await writeFile(statePath(), JSON.stringify(s), "utf8");
}

// Cross-process advisory lock via O_EXCL create. Atomic on POSIX.
async function acquireLock(): Promise<void> {
  await mkdir(logsDir(), { recursive: true });
  const start = Date.now();
  while (true) {
    try {
      const fh = await open(lockPath(), "wx");
      await fh.writeFile(JSON.stringify({ ts: Date.now(), pid: process.pid }));
      await fh.close();
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      // Reclaim stale lock if its recorded ts is older than threshold.
      // NOTE: do NOT steal on parse failure — `open("wx")` creates the file
      // before the holder writes content, so an empty/partial read here is
      // almost always a fresh holder mid-write, not a stale lock. Stealing
      // in that window lets both callers hold the "lock" simultaneously.
      try {
        const buf = await readFile(lockPath(), "utf8");
        const parsed = JSON.parse(buf) as { ts?: number };
        if (
          typeof parsed.ts === "number" &&
          Number.isFinite(parsed.ts) &&
          Date.now() - parsed.ts > STALE_LOCK_MS
        ) {
          await unlink(lockPath()).catch(() => {});
          continue;
        }
      } catch {
        // Unreadable content — fall through to poll-and-retry. If it remains
        // unreadable past LOCK_MAX_WAIT_MS, we'll bail with SafetyError below.
      }

      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        throw new SafetyError(
          `could not acquire safety lock after ${LOCK_MAX_WAIT_MS}ms — another write may be in flight`,
        );
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
}

async function releaseLock(): Promise<void> {
  await unlink(lockPath()).catch(() => {});
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock();
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
}

/**
 * Atomic check-and-record for a write attempt. On success, records the
 * attempt before returning so callers always see consistent rate-limit
 * accounting (even if the subsequent subprocess fails). On any violation,
 * throws SafetyError and records nothing.
 *
 * Concurrency: rate/cooldown checks run under an O_EXCL file lock so
 * parallel invocations (same or different processes) cannot bypass limits.
 */
export async function claimWriteSlot(opts: WriteCheckOptions): Promise<void> {
  // Pure input gates — no state read needed, so outside the lock.
  if (opts.budgetCents !== undefined) {
    const prev = opts.previousBudgetCents;
    if (prev === undefined || prev <= 0) {
      // No prior budget known. Treat as a fresh-budget case and require
      // explicit acknowledgement — we can't verify the 2x cap, so fail closed.
      if (!opts.firstBudgetConfirmed) {
        throw new SafetyError(
          "current budget could not be verified. Requires --first-budget to set without prior comparison.",
        );
      }
    } else {
      const ratio = opts.budgetCents / prev;
      if (ratio > BUDGET_DOUBLE_CONFIRM_MULTIPLIER && !opts.largeBudgetConfirmed) {
        throw new SafetyError(
          `budget change ${ratio.toFixed(2)}x exceeds ${BUDGET_DOUBLE_CONFIRM_MULTIPLIER}x cap. Requires double confirmation (--confirm-large-budget).`,
        );
      }
    }
  }
  if (opts.activation && !opts.activationConfirmed) {
    throw new SafetyError(
      "activation requires double confirmation (--confirm-activate, spec §4.2).",
    );
  }

  await withLock(async () => {
    const state = await loadState();
    const now = Date.now();
    const recent = state.writes.filter((t) => t > now - ONE_HOUR_MS);

    if (recent.length >= MAX_WRITES_PER_HOUR) {
      throw new SafetyError(
        `rate limit: ${MAX_WRITES_PER_HOUR} writes per hour exceeded. Try again later.`,
      );
    }
    const last = recent[recent.length - 1];
    if (last !== undefined && now - last < COOLDOWN_MS) {
      const wait = COOLDOWN_MS - (now - last);
      throw new SafetyError(
        `cooldown: must wait ${wait}ms (${COOLDOWN_MS}ms between consecutive writes).`,
      );
    }

    recent.push(now);
    await saveState({ writes: recent });
  });
}

// Test-only utility — clears state without touching the lockfile.
export async function __resetSafetyForTest(): Promise<void> {
  await unlink(statePath()).catch(() => {});
  await unlink(lockPath()).catch(() => {});
}
