import { test, expect } from "bun:test";
import { analyzeFatigue, type AdInsight } from "./fatigue.ts";
import type { Benchmarks } from "./config.ts";

const BENCH: Benchmarks = {
  targetCpaCents: 3000,
  minCtr: 0.01,
  maxFrequency: 3.5,
  ctrDropPctThreshold: 0.20,
  minRoas: 2.0,
};

test("empty inputs return empty", () => {
  expect(analyzeFatigue([], [], BENCH)).toEqual([]);
});

test("ad with no fatigue is not flagged", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.02, frequency: 2.0, cpc: 1.0 }];
  const prev: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.021, frequency: 1.8, cpc: 1.0 }];
  expect(analyzeFatigue(cur, prev, BENCH)).toEqual([]);
});

test("ctr drop ≥ 20% flags ctr_decline", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.016, frequency: 2.0, cpc: 1.0 }];
  const prev: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.020, frequency: 1.9, cpc: 1.0 }];
  const r = analyzeFatigue(cur, prev, BENCH);
  expect(r).toHaveLength(1);
  expect(r[0]!.flags).toContain("ctr_decline");
  expect(r[0]!.metrics.ctr_drop_pct).toBe(20);
});

test("frequency > 3.5 flags frequency_high → narrow audience", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.02, frequency: 4.0, cpc: 1.0 }];
  const prev: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.02, frequency: 3.0, cpc: 1.0 }];
  const r = analyzeFatigue(cur, prev, BENCH);
  expect(r[0]!.flags).toEqual(["frequency_high"]);
  expect(r[0]!.recommendation).toBe("Narrow audience");
});

test("cpc rising while ctr falling flags cpc_rising", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.018, frequency: 2.0, cpc: 1.50 }];
  const prev: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.020, frequency: 1.9, cpc: 1.10 }];
  const r = analyzeFatigue(cur, prev, BENCH);
  expect(r[0]!.flags).toContain("cpc_rising");
});

test("all three flags → pause recommendation", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.010, frequency: 4.5, cpc: 2.0 }];
  const prev: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.020, frequency: 3.0, cpc: 1.0 }];
  const r = analyzeFatigue(cur, prev, BENCH);
  expect(r[0]!.flags.sort()).toEqual(["cpc_rising", "ctr_decline", "frequency_high"]);
  expect(r[0]!.recommendation).toBe("Pause and refresh creative");
});

test("ranks more-flagged ads before less-flagged", () => {
  const cur: AdInsight[] = [
    { ad_id: "low", name: "L", ctr: 0.02, frequency: 4.0, cpc: 1.0 },
    { ad_id: "high", name: "H", ctr: 0.010, frequency: 4.5, cpc: 2.0 },
  ];
  const prev: AdInsight[] = [
    { ad_id: "low", name: "L", ctr: 0.02, frequency: 3.0, cpc: 1.0 },
    { ad_id: "high", name: "H", ctr: 0.020, frequency: 3.0, cpc: 1.0 },
  ];
  const r = analyzeFatigue(cur, prev, BENCH);
  expect(r[0]!.ad_id).toBe("high");
  expect(r[1]!.ad_id).toBe("low");
});

test("handles string-typed numeric fields from CLI JSON", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: "0.010", frequency: "4.0", cpc: "1.5" }];
  const prev: AdInsight[] = [{ ad_id: "1", name: "A", ctr: "0.020", frequency: "3.0", cpc: "1.0" }];
  const r = analyzeFatigue(cur, prev, BENCH);
  expect(r[0]!.flags.length).toBe(3);
});

test("missing prev row → only flags that don't require comparison", () => {
  const cur: AdInsight[] = [{ ad_id: "1", name: "A", ctr: 0.01, frequency: 4.0, cpc: 1.0 }];
  const r = analyzeFatigue(cur, [], BENCH);
  expect(r[0]!.flags).toEqual(["frequency_high"]);
});
