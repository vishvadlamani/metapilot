import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBenchmarks, loadPreferences } from "./config.ts";

let tmpDir: string;
let prevCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "metapilot-config-"));
  mkdirSync(join(tmpDir, "config"), { recursive: true });
  prevCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

test("loadBenchmarks: missing file returns defaults", async () => {
  const b = await loadBenchmarks();
  expect(b.targetCpaCents).toBe(3000);
  expect(b.minCtr).toBe(0.01);
  expect(b.maxFrequency).toBe(3.5);
  expect(b.ctrDropPctThreshold).toBe(0.20);
  expect(b.minRoas).toBe(2.0);
});

test("loadBenchmarks: malformed JSON returns defaults", async () => {
  writeFileSync("config/benchmarks.json", "{not valid");
  const b = await loadBenchmarks();
  expect(b.targetCpaCents).toBe(3000);
});

test("loadBenchmarks: partial JSON merges with defaults", async () => {
  writeFileSync(
    "config/benchmarks.json",
    JSON.stringify({ targetCpaCents: 5000, minRoas: 3.5 }),
  );
  const b = await loadBenchmarks();
  expect(b.targetCpaCents).toBe(5000);
  expect(b.minRoas).toBe(3.5);
  // Untouched fields fall through to defaults.
  expect(b.maxFrequency).toBe(3.5);
  expect(b.minCtr).toBe(0.01);
});

test("loadBenchmarks: empty object returns full defaults", async () => {
  writeFileSync("config/benchmarks.json", "{}");
  const b = await loadBenchmarks();
  expect(b.targetCpaCents).toBe(3000);
  expect(b.minRoas).toBe(2.0);
});

test("loadPreferences: missing file returns defaults", async () => {
  const p = await loadPreferences();
  expect(p.defaultDateRange).toBe("last_7d");
  expect(p.currency).toBe("USD");
  expect(p.compactOutput).toBe(false);
  expect(p.accountTimezone).toBe("UTC");
});

test("loadPreferences: override accountTimezone", async () => {
  writeFileSync(
    "config/preferences.json",
    JSON.stringify({ accountTimezone: "America/New_York" }),
  );
  const p = await loadPreferences();
  expect(p.accountTimezone).toBe("America/New_York");
  expect(p.currency).toBe("USD");
});

test("loadPreferences: override single field", async () => {
  writeFileSync(
    "config/preferences.json",
    JSON.stringify({ currency: "EUR" }),
  );
  const p = await loadPreferences();
  expect(p.currency).toBe("EUR");
  expect(p.defaultDateRange).toBe("last_7d");
});

test("loadPreferences: malformed JSON returns defaults", async () => {
  writeFileSync("config/preferences.json", "this is not json");
  const p = await loadPreferences();
  expect(p.currency).toBe("USD");
});
