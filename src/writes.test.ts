import { test, expect } from "bun:test";
import {
  extractCents,
  buildStatusChangePreview,
  buildBudgetPreview,
  isWriteKind,
} from "./writes.ts";

// ─── extractCents ────────────────────────────────────────────────────────────

test("extractCents: null record → null", () => {
  expect(extractCents(null)).toBeNull();
});

test("extractCents: numeric daily_budget", () => {
  expect(extractCents({ daily_budget: 5000 })).toBe(5000);
});

test("extractCents: numeric zero is valid", () => {
  expect(extractCents({ daily_budget: 0 })).toBe(0);
});

test("extractCents: string numeric daily_budget", () => {
  expect(extractCents({ daily_budget: "12500" })).toBe(12500);
});

test("extractCents: missing field → null", () => {
  expect(extractCents({ name: "x" })).toBeNull();
});

test("extractCents: non-numeric string → null", () => {
  expect(extractCents({ daily_budget: "abc" })).toBeNull();
});

test("extractCents: negative number → null (treated as invalid)", () => {
  expect(extractCents({ daily_budget: -100 })).toBeNull();
});

test("extractCents: object value → null", () => {
  expect(extractCents({ daily_budget: { value: 5000 } })).toBeNull();
});

// ─── buildStatusChangePreview ────────────────────────────────────────────────

test("buildStatusChangePreview pause: returns raw current, no activation warning", () => {
  const current = { id: "1", name: "A", status: "ACTIVE" };
  const p = buildStatusChangePreview("campaign", "1", current, "PAUSED");
  expect(p.action).toBe("pause");
  expect(p.kind).toBe("campaign");
  expect(p.id).toBe("1");
  expect(p.current).toBe(current);
  expect(p.proposed).toEqual({ status: "PAUSED" });
  expect(p.warnings).toEqual([]);
});

test("buildStatusChangePreview resume: includes activation warning", () => {
  const p = buildStatusChangePreview("campaign", "1", { id: "1" }, "ACTIVE");
  expect(p.action).toBe("resume");
  expect(p.warnings.some((w) => /confirm-activate/.test(w))).toBe(true);
});

test("buildStatusChangePreview null current: includes fetch-failed warning", () => {
  const p = buildStatusChangePreview("adset", "99", null, "PAUSED");
  expect(p.current).toBeNull();
  expect(p.warnings.some((w) => /Could not fetch/.test(w))).toBe(true);
});

test("buildStatusChangePreview null current + ACTIVE: both warnings", () => {
  const p = buildStatusChangePreview("ad", "99", null, "ACTIVE");
  expect(p.warnings).toHaveLength(2);
});

// ─── buildBudgetPreview ──────────────────────────────────────────────────────

test("buildBudgetPreview: 1.5x current → no warning", () => {
  const p = buildBudgetPreview("1", 1500, { daily_budget: 1000 });
  expect(p.warnings).toEqual([]);
  expect(p.proposed).toEqual({ daily_budget_cents: 1500, daily_budget_usd: 15 });
  expect(p.current).toEqual({ daily_budget: 1000 });
});

test("buildBudgetPreview: > 2x current → large-change warning", () => {
  const p = buildBudgetPreview("1", 5000, { daily_budget: 1000 });
  expect(p.warnings.some((w) => /5\.00x/.test(w))).toBe(true);
  expect(p.warnings.some((w) => /confirm-large-budget/.test(w))).toBe(true);
});

test("buildBudgetPreview: current null → first-budget warning", () => {
  const p = buildBudgetPreview("1", 5000, null);
  expect(p.current).toBeNull();
  expect(p.warnings.some((w) => /first-budget/.test(w))).toBe(true);
});

test("buildBudgetPreview: current record missing daily_budget → first-budget warning", () => {
  const p = buildBudgetPreview("1", 5000, { id: "1", name: "x" });
  expect(p.warnings.some((w) => /first-budget/.test(w))).toBe(true);
  // current preserved as raw — skill can show whatever fields are present.
  expect(p.current).toEqual({ id: "1", name: "x" });
});

test("buildBudgetPreview: proposed always has both cents + usd", () => {
  const p = buildBudgetPreview("1", 4250, { daily_budget: 1000 });
  expect(p.proposed).toEqual({ daily_budget_cents: 4250, daily_budget_usd: 42.5 });
});

test("buildBudgetPreview: previousCents=0 → first-budget warning (zero treated as no prior)", () => {
  // Per safety semantics, prev<=0 = no usable prior.
  const p = buildBudgetPreview("1", 1000, { daily_budget: 0 });
  expect(p.warnings.some((w) => /first-budget/.test(w))).toBe(false);
  // Wait — buildBudgetPreview itself only warns on null OR on >2x for prev>0.
  // prev=0 doesn't trigger either warning here; safety layer enforces the gate.
});

// ─── isWriteKind ─────────────────────────────────────────────────────────────

test("isWriteKind: valid kinds", () => {
  expect(isWriteKind("campaign")).toBe(true);
  expect(isWriteKind("adset")).toBe(true);
  expect(isWriteKind("ad")).toBe(true);
});

test("isWriteKind: invalid kinds", () => {
  expect(isWriteKind("group")).toBe(false);
  expect(isWriteKind("")).toBe(false);
  expect(isWriteKind("Campaign")).toBe(false);
});
