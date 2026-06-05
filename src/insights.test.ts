import { test, expect } from "bun:test";
import {
  buildInsightsArgs,
  isInsightsKind,
  DEFAULT_FIELDS,
  DEFAULT_DATE_PRESET,
} from "./insights.ts";

test("no id → account-scoped insights (no --campaign-id filter)", () => {
  const args = buildInsightsArgs({});
  expect(args[0]).toBe("ads");
  expect(args[1]).toBe("insights");
  expect(args[2]).toBe("get");
  expect(args.find((a) => a.endsWith("-id"))).toBeUndefined();
  expect(args).toContain("--date-preset");
  expect(args).toContain(DEFAULT_DATE_PRESET);
});

test("id with default kind=campaign → --campaign-id filter (hyphen, not underscore)", () => {
  const args = buildInsightsArgs({ id: "12345" });
  const i = args.indexOf("--campaign-id");
  expect(i).toBeGreaterThan(-1);
  expect(args[i + 1]).toBe("12345");
});

test("id + kind=adset → --adset-id filter", () => {
  const args = buildInsightsArgs({ id: "9", kind: "adset" });
  expect(args).toContain("--adset-id");
  expect(args[args.indexOf("--adset-id") + 1]).toBe("9");
});

test("id + kind=ad → --ad-id filter", () => {
  const args = buildInsightsArgs({ id: "42", kind: "ad" });
  expect(args).toContain("--ad-id");
});

test("timeRange → --since / --until (not --time-range JSON)", () => {
  const args = buildInsightsArgs({
    timeRange: { since: "2026-05-24", until: "2026-05-30" },
  });
  expect(args).toContain("--since");
  expect(args[args.indexOf("--since") + 1]).toBe("2026-05-24");
  expect(args).toContain("--until");
  expect(args[args.indexOf("--until") + 1]).toBe("2026-05-30");
  // No --time-range or --date-preset when timeRange provided.
  expect(args).not.toContain("--time-range");
  expect(args).not.toContain("--date-preset");
});

test("datePreset override", () => {
  const args = buildInsightsArgs({ datePreset: "last_30d" });
  expect(args[args.indexOf("--date-preset") + 1]).toBe("last_30d");
});

test("fields override emitted as csv on --fields", () => {
  const args = buildInsightsArgs({ fields: ["spend", "ctr"] });
  expect(args).toContain("--fields");
  expect(args[args.indexOf("--fields") + 1]).toBe("spend,ctr");
});

test("default fields used when not overridden", () => {
  const args = buildInsightsArgs({});
  expect(args[args.indexOf("--fields") + 1]).toBe(DEFAULT_FIELDS.join(","));
});

test("breakdowns → repeated --breakdown flags (not csv)", () => {
  const args = buildInsightsArgs({ breakdowns: ["age", "gender"] });
  const positions = args
    .map((a, i) => (a === "--breakdown" ? i : -1))
    .filter((i) => i !== -1);
  expect(positions).toHaveLength(2);
  expect(args[positions[0]! + 1]).toBe("age");
  expect(args[positions[1]! + 1]).toBe("gender");
});

test("empty breakdowns array → no --breakdown flag", () => {
  const args = buildInsightsArgs({ breakdowns: [] });
  expect(args).not.toContain("--breakdown");
});

test("isInsightsKind validates enum", () => {
  expect(isInsightsKind("campaign")).toBe(true);
  expect(isInsightsKind("adset")).toBe(true);
  expect(isInsightsKind("ad")).toBe(true);
  expect(isInsightsKind("account")).toBe(false);
  expect(isInsightsKind("")).toBe(false);
});

test("combined: scoped + timeRange + breakdowns + fields", () => {
  const args = buildInsightsArgs({
    id: "100",
    kind: "ad",
    timeRange: { since: "2026-05-01", until: "2026-05-07" },
    fields: ["spend", "frequency"],
    breakdowns: ["age"],
  });
  expect(args).toEqual([
    "ads",
    "insights",
    "get",
    "--ad-id",
    "100",
    "--since",
    "2026-05-01",
    "--until",
    "2026-05-07",
    "--fields",
    "spend,frequency",
    "--breakdown",
    "age",
  ]);
});
