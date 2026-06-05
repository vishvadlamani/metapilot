import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SafetyError,
  claimWriteSlot,
  __resetSafetyForTest,
} from "./safety.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "metapilot-safety-"));
  process.env["METAPILOT_LOGS_DIR"] = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["METAPILOT_LOGS_DIR"];
});

test("first write succeeds with no prior state", async () => {
  await expect(claimWriteSlot({})).resolves.toBeUndefined();
});

test("second write inside cooldown is blocked", async () => {
  await claimWriteSlot({});
  await expect(claimWriteSlot({})).rejects.toThrow(SafetyError);
  await expect(claimWriteSlot({})).rejects.toThrow(/cooldown/);
});

test("budget > 2x current is blocked without confirm flag", async () => {
  await expect(
    claimWriteSlot({ budgetCents: 5000, previousBudgetCents: 1000 }),
  ).rejects.toThrow(/2x cap/);
});

test("budget > 2x with --confirm-large-budget passes through to rate check", async () => {
  await expect(
    claimWriteSlot({
      budgetCents: 5000,
      previousBudgetCents: 1000,
      largeBudgetConfirmed: true,
    }),
  ).resolves.toBeUndefined();
});

test("budget within 2x allowed", async () => {
  await expect(
    claimWriteSlot({ budgetCents: 1500, previousBudgetCents: 1000 }),
  ).resolves.toBeUndefined();
});

test("budget with undefined prior is blocked unless --first-budget", async () => {
  await expect(
    claimWriteSlot({ budgetCents: 5000 }),
  ).rejects.toThrow(/could not be verified/);
});

test("budget with undefined prior + firstBudgetConfirmed passes", async () => {
  await expect(
    claimWriteSlot({ budgetCents: 5000, firstBudgetConfirmed: true }),
  ).resolves.toBeUndefined();
});

test("budget with prev=0 treated as no prior (requires firstBudgetConfirmed)", async () => {
  await expect(
    claimWriteSlot({ budgetCents: 5000, previousBudgetCents: 0 }),
  ).rejects.toThrow(/could not be verified/);
});

test("activation without activationConfirmed is blocked", async () => {
  await expect(
    claimWriteSlot({ activation: true }),
  ).rejects.toThrow(/activation/);
});

test("activation with activationConfirmed passes", async () => {
  await expect(
    claimWriteSlot({ activation: true, activationConfirmed: true }),
  ).resolves.toBeUndefined();
});

test("11th write in window blocked", async () => {
  const now = Date.now();
  const writes = Array.from({ length: 10 }, (_, i) => now - 10_000 + i);
  writeFileSync(join(tmpDir, ".safety-state.json"), JSON.stringify({ writes }));
  await expect(claimWriteSlot({})).rejects.toThrow(/rate limit/);
});

test("writes older than 1 hour are purged from accounting", async () => {
  const now = Date.now();
  const ancient = Array.from({ length: 10 }, (_, i) => now - (60 * 60 * 1000) - 1000 - i);
  writeFileSync(join(tmpDir, ".safety-state.json"), JSON.stringify({ writes: ancient }));
  await expect(claimWriteSlot({})).resolves.toBeUndefined();
});

test("violations do not record a write attempt", async () => {
  await expect(
    claimWriteSlot({ budgetCents: 5000, previousBudgetCents: 1000 }),
  ).rejects.toThrow();
  // Next valid write should succeed → proves previous attempt left no trace.
  await expect(claimWriteSlot({})).resolves.toBeUndefined();
});

test("corrupt state file resets gracefully to empty", async () => {
  writeFileSync(join(tmpDir, ".safety-state.json"), "{not valid json");
  await expect(claimWriteSlot({})).resolves.toBeUndefined();
});

test("state file with non-array writes field resets gracefully", async () => {
  writeFileSync(join(tmpDir, ".safety-state.json"), JSON.stringify({ writes: "nope" }));
  await expect(claimWriteSlot({})).resolves.toBeUndefined();
});

test("concurrent calls — only one passes the cooldown gate", async () => {
  // Seed a fresh state, then fire 2 concurrent claims. One records first, the
  // other sees the cooldown.
  const results = await Promise.allSettled([
    claimWriteSlot({}),
    claimWriteSlot({}),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SafetyError);
});

test("concurrent rate-limit boundary — 11 parallel writes against fresh state record exactly 10", async () => {
  // Fresh state, no cooldown to worry about: each call's claim records `now`,
  // but cooldown blocks subsequent ones in real time. Pre-seed with old writes
  // to bypass cooldown for this test scenario.
  const now = Date.now();
  // 9 writes spaced 6 seconds apart, ending > 5s ago → no cooldown blocker.
  const seeded = Array.from({ length: 9 }, (_, i) => now - 60_000 - i * 6000);
  writeFileSync(join(tmpDir, ".safety-state.json"), JSON.stringify({ writes: seeded }));

  // Fire 5 concurrent — first wins (10th slot), rest cooldown-blocked (within 5s of new write).
  const results = await Promise.allSettled([
    claimWriteSlot({}),
    claimWriteSlot({}),
    claimWriteSlot({}),
    claimWriteSlot({}),
    claimWriteSlot({}),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  expect(fulfilled).toHaveLength(1);
});

test("__resetSafetyForTest clears state", async () => {
  await claimWriteSlot({});
  await __resetSafetyForTest();
  await expect(claimWriteSlot({})).resolves.toBeUndefined();
});
