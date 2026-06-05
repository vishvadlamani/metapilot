import { test, expect } from "bun:test";
import {
  parseArgs,
  strFlag,
  splitCsv,
  usdToCents,
  requireAdAccount,
  UsageError,
} from "./parse.ts";
import { beforeEach, afterEach } from "bun:test";

test("empty argv → empty parsed", () => {
  const r = parseArgs([]);
  expect(r.positional).toEqual([]);
  expect(r.flags.size).toBe(0);
});

test("positional args only", () => {
  const r = parseArgs(["pause", "campaign", "12345"]);
  expect(r.positional).toEqual(["pause", "campaign", "12345"]);
});

test("--key=value form", () => {
  const r = parseArgs(["--since=last_30d", "--fields=spend,clicks"]);
  expect(strFlag(r.flags, "--since")).toBe("last_30d");
  expect(strFlag(r.flags, "--fields")).toBe("spend,clicks");
});

test("--key value form", () => {
  const r = parseArgs(["--since", "last_30d"]);
  expect(strFlag(r.flags, "--since")).toBe("last_30d");
});

test("known boolean flags are not greedy", () => {
  const r = parseArgs(["pause", "campaign", "12345", "--yes"]);
  expect(r.flags.get("--yes")).toBe(true);
  expect(r.positional).toEqual(["pause", "campaign", "12345"]);
});

test("multiple booleans in a row", () => {
  const r = parseArgs(["--yes", "--confirm-activate", "--confirm-large-budget"]);
  expect(r.flags.get("--yes")).toBe(true);
  expect(r.flags.get("--confirm-activate")).toBe(true);
  expect(r.flags.get("--confirm-large-budget")).toBe(true);
});

test("value-flag with following flag throws UsageError (strict mode)", () => {
  expect(() => parseArgs(["--kind", "--yes"])).toThrow(UsageError);
  expect(() => parseArgs(["--kind", "--yes"])).toThrow(/requires a value/);
});

test("trailing value-flag with no value throws UsageError", () => {
  expect(() => parseArgs(["--kind"])).toThrow(UsageError);
});

test("--first-budget is recognized as boolean", () => {
  const r = parseArgs(["--first-budget"]);
  expect(r.flags.get("--first-budget")).toBe(true);
});

test("strFlag returns undefined for boolean", () => {
  const r = parseArgs(["--yes"]);
  expect(strFlag(r.flags, "--yes")).toBeUndefined();
});

test("strFlag returns undefined for missing flag", () => {
  const r = parseArgs([]);
  expect(strFlag(r.flags, "--missing")).toBeUndefined();
});

test("splitCsv trims and drops empties", () => {
  expect(splitCsv("a, b,  ,c")).toEqual(["a", "b", "c"]);
});

test("splitCsv undefined for empty input", () => {
  expect(splitCsv(undefined)).toBeUndefined();
  expect(splitCsv("")).toBeUndefined();
  expect(splitCsv(",  ,")).toBeUndefined();
});

test("usdToCents rounds to integer cents", () => {
  expect(usdToCents("40")).toBe(4000);
  expect(usdToCents("40.00")).toBe(4000);
  expect(usdToCents("40.005")).toBe(4001); // 4000.5 → rounds up
  expect(usdToCents("0.99")).toBe(99);
  expect(usdToCents("0")).toBe(0);
});

test("usdToCents rejects invalid input", () => {
  expect(() => usdToCents("nope")).toThrow(UsageError);
  expect(() => usdToCents("-1")).toThrow(UsageError);
  expect(() => usdToCents("")).toThrow(UsageError);
});

// ─── requireAdAccount ────────────────────────────────────────────────────────

let savedAdAccount: string | undefined;
beforeEach(() => {
  savedAdAccount = process.env["AD_ACCOUNT_ID"];
  delete process.env["AD_ACCOUNT_ID"];
});
afterEach(() => {
  if (savedAdAccount !== undefined) process.env["AD_ACCOUNT_ID"] = savedAdAccount;
  else delete process.env["AD_ACCOUNT_ID"];
});

test("requireAdAccount: throws when env var unset", () => {
  expect(() => requireAdAccount()).toThrow(UsageError);
  expect(() => requireAdAccount()).toThrow(/AD_ACCOUNT_ID/);
});

test("requireAdAccount: passes when env var set", () => {
  process.env["AD_ACCOUNT_ID"] = "act_12345";
  expect(() => requireAdAccount()).not.toThrow();
});

test("requireAdAccount: error message names the next step", () => {
  try {
    requireAdAccount();
    throw new Error("should have thrown");
  } catch (e) {
    expect((e as Error).message).toMatch(/metapilot accounts/);
    expect((e as Error).message).toMatch(/export AD_ACCOUNT_ID/);
  }
});

test("mixed positional and flags", () => {
  const r = parseArgs([
    "insights",
    "12345",
    "--kind=campaign",
    "--since=last_7d",
    "--breakdowns=age,gender",
  ]);
  expect(r.positional).toEqual(["insights", "12345"]);
  expect(strFlag(r.flags, "--kind")).toBe("campaign");
  expect(strFlag(r.flags, "--since")).toBe("last_7d");
  expect(strFlag(r.flags, "--breakdowns")).toBe("age,gender");
});
