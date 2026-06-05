import { runMeta, type MetaResult } from "./meta-cli.ts";

export type WriteKind = "campaign" | "adset" | "ad";

export const WRITE_KINDS: readonly WriteKind[] = ["campaign", "adset", "ad"];

export type Preview = {
  action: "pause" | "resume" | "budget";
  kind: WriteKind;
  id: string;
  // Raw record returned by `meta ads <kind> get <id>`, or null when the fetch
  // failed (no auth, wrong id, etc.). Uniform shape across all preview types.
  current: Record<string, unknown> | null;
  proposed: Record<string, unknown>;
  warnings: string[];
};

export function isWriteKind(v: string): v is WriteKind {
  return (WRITE_KINDS as readonly string[]).includes(v);
}

/**
 * Extract `daily_budget` from a `meta ads adset get` record. Returns cents
 * as an integer, or null if absent / non-numeric / negative.
 *
 * Pure — exported for unit testing.
 */
export function extractCents(
  current: Record<string, unknown> | null,
): number | null {
  if (!current) return null;
  const raw = current["daily_budget"];
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

// ─── Pure preview builders ───────────────────────────────────────────────────
// These take the already-fetched `current` record (or null) and produce a
// Preview. No I/O; safe to unit-test in isolation.

export function buildStatusChangePreview(
  kind: WriteKind,
  id: string,
  current: Record<string, unknown> | null,
  newStatus: "PAUSED" | "ACTIVE",
): Preview {
  const warnings: string[] = [];
  if (current === null) {
    warnings.push(
      `Could not fetch current state of ${kind} ${id}. Confirm the ID is correct before proceeding.`,
    );
  }
  if (newStatus === "ACTIVE") {
    warnings.push(
      "Activation requires --confirm-activate (spec §4.2 double confirmation).",
    );
  }
  return {
    action: newStatus === "PAUSED" ? "pause" : "resume",
    kind,
    id,
    current,
    proposed: { status: newStatus },
    warnings,
  };
}

export function buildBudgetPreview(
  adsetId: string,
  newCents: number,
  current: Record<string, unknown> | null,
): Preview {
  const previousCents = extractCents(current);
  const warnings: string[] = [];

  if (previousCents === null) {
    warnings.push(
      `Could not read current budget for adset ${adsetId}. Treat as a fresh budget — requires --first-budget to proceed.`,
    );
  } else if (previousCents > 0) {
    const ratio = newCents / previousCents;
    if (ratio > 2) {
      warnings.push(
        `Proposed budget is ${ratio.toFixed(2)}x current ($${(previousCents / 100).toFixed(2)} → $${(newCents / 100).toFixed(2)}). Requires --confirm-large-budget.`,
      );
    }
  }

  return {
    action: "budget",
    kind: "adset",
    id: adsetId,
    current,
    proposed: {
      daily_budget_cents: newCents,
      daily_budget_usd: newCents / 100,
    },
    warnings,
  };
}

// ─── I/O wrappers ────────────────────────────────────────────────────────────

async function fetchCurrent(
  kind: WriteKind,
  id: string,
): Promise<Record<string, unknown> | null> {
  const r = await runMeta<Record<string, unknown>>(
    ["ads", kind, "get", id],
    { mutating: false },
  );
  if (r.exitCode !== 0) return null;
  return r.parsed;
}

export async function previewStatusChange(
  kind: WriteKind,
  id: string,
  newStatus: "PAUSED" | "ACTIVE",
): Promise<Preview> {
  const current = await fetchCurrent(kind, id);
  return buildStatusChangePreview(kind, id, current, newStatus);
}

export async function previewBudget(
  adsetId: string,
  newCents: number,
): Promise<Preview> {
  const current = await fetchCurrent("adset", adsetId);
  return buildBudgetPreview(adsetId, newCents, current);
}

export async function executeStatusChange(
  kind: WriteKind,
  id: string,
  newStatus: "PAUSED" | "ACTIVE",
  confirmActivate: boolean,
): Promise<MetaResult> {
  return runMeta(
    ["ads", kind, "update", id, "--status", newStatus],
    {
      mutating: true,
      activation: newStatus === "ACTIVE",
      activationConfirmed: confirmActivate,
    },
  );
}

export async function executeBudget(
  adsetId: string,
  newCents: number,
  largeBudgetConfirmed: boolean,
  firstBudgetConfirmed: boolean,
): Promise<MetaResult> {
  const current = await fetchCurrent("adset", adsetId);
  const previousCents = extractCents(current);

  return runMeta(
    ["ads", "adset", "update", adsetId, "--daily-budget", String(newCents)],
    {
      mutating: true,
      budgetCents: newCents,
      previousBudgetCents: previousCents ?? undefined,
      largeBudgetConfirmed,
      firstBudgetConfirmed,
    },
  );
}
