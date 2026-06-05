import { test, expect } from "bun:test";
import { assembleBriefing, type BriefingInputs } from "./briefing.ts";
import type { Benchmarks } from "./config.ts";

const BENCH: Benchmarks = {
  targetCpaCents: 3000,
  minCtr: 0.01,
  maxFrequency: 3.5,
  ctrDropPctThreshold: 0.20,
  minRoas: 2.0,
};

// Fixed clock: 2026-05-31 12:00 UTC → 50% of day elapsed.
const NOON_UTC = Date.UTC(2026, 4, 31, 12, 0, 0);

function base(over: Partial<BriefingInputs> = {}): BriefingInputs {
  return {
    todaySpend: {},
    activeCampaigns: [],
    weekly: [],
    adsCurrent: [],
    adsPrevious: [],
    benchmarks: BENCH,
    nowMs: NOON_UTC,
    ...over,
  };
}

test("empty inputs produce minimal report", () => {
  const r = assembleBriefing(base());
  expect(r.pacing.status).toBe("unknown");
  expect(r.active_campaigns).toEqual([]);
  expect(r.performance_7d).toEqual([]);
  expect(r.ad_leaders.top).toEqual([]);
  expect(r.fatigue).toEqual([]);
});

test("day fraction elapsed = 0.5 at UTC noon", () => {
  const r = assembleBriefing(base());
  expect(r.pacing.day_fraction_elapsed).toBe(0.5);
});

test("pacing on_track when spend ≈ expected", () => {
  const r = assembleBriefing(base({
    todaySpend: { spend: 50 },
    activeCampaigns: [{ id: "1", daily_budget: 10000 }], // $100/day
  }));
  // expected at noon = $50 → today_spend $50 → delta 0% → on_track
  expect(r.pacing.status).toBe("on_track");
  expect(r.pacing.expected_spend_usd).toBe(50);
});

test("pacing overpacing when spend >> expected", () => {
  const r = assembleBriefing(base({
    todaySpend: { spend: 90 },
    activeCampaigns: [{ id: "1", daily_budget: 10000 }],
  }));
  expect(r.pacing.status).toBe("overpacing");
  expect(r.pacing.delta_pct).toBe(0.8);
});

test("pacing underpacing when spend << expected", () => {
  const r = assembleBriefing(base({
    todaySpend: { spend: 10 },
    activeCampaigns: [{ id: "1", daily_budget: 10000 }],
  }));
  expect(r.pacing.status).toBe("underpacing");
});

test("pacing unknown when no budget set", () => {
  const r = assembleBriefing(base({ todaySpend: { spend: 50 } }));
  expect(r.pacing.status).toBe("unknown");
});

test("active campaigns map daily_budget cents → usd", () => {
  const r = assembleBriefing(base({
    activeCampaigns: [
      { id: "1", name: "Alpha", daily_budget: 5000 },
      { id: "2", name: "Beta", daily_budget: 12500 },
    ],
  }));
  expect(r.active_campaigns).toHaveLength(2);
  expect(r.active_campaigns[0]!.daily_budget_usd).toBe(50);
  expect(r.active_campaigns[1]!.daily_budget_usd).toBe(125);
});

test("performance_7d sorted by spend desc", () => {
  const r = assembleBriefing(base({
    weekly: [
      { campaign_id: "a", spend: 50 },
      { campaign_id: "b", spend: 300 },
      { campaign_id: "c", spend: 150 },
    ],
  }));
  expect(r.performance_7d.map((x) => x.campaign_id)).toEqual(["b", "c", "a"]);
});

test("ad_leaders.top sorts by roas desc, skips low-spend ads", () => {
  const r = assembleBriefing(base({
    adsCurrent: [
      { ad_id: "high", spend: 200, purchase_roas: 5.0 },
      { ad_id: "mid", spend: 100, purchase_roas: 3.0 },
      { ad_id: "low", spend: 60, purchase_roas: 2.0 },
      { ad_id: "tiny", spend: 10, purchase_roas: 10.0 }, // filtered
    ],
  }));
  expect(r.ad_leaders.top.map((x) => x.ad_id)).toEqual(["high", "mid", "low"]);
});

test("ad_leaders.bottom sorts by roas asc", () => {
  const r = assembleBriefing(base({
    adsCurrent: [
      { ad_id: "high", spend: 200, purchase_roas: 5.0 },
      { ad_id: "mid", spend: 100, purchase_roas: 3.0 },
      { ad_id: "worst", spend: 80, purchase_roas: 0.5 },
    ],
  }));
  expect(r.ad_leaders.bottom[0]!.ad_id).toBe("worst");
});

test("day fraction respects accountTimezone — UTC noon = 08:00 EDT (0.333)", () => {
  // 2026-05-31 12:00 UTC is 08:00 in America/New_York (EDT, UTC-4).
  const r = assembleBriefing(base({ accountTimezone: "America/New_York" }));
  expect(r.pacing.day_fraction_elapsed).toBeCloseTo(8 / 24, 3);
});

test("day fraction respects accountTimezone — UTC noon = 21:00 JST (0.875)", () => {
  // 2026-05-31 12:00 UTC is 21:00 in Asia/Tokyo (JST, UTC+9).
  const r = assembleBriefing(base({ accountTimezone: "Asia/Tokyo" }));
  expect(r.pacing.day_fraction_elapsed).toBeCloseTo(21 / 24, 3);
});

test("unknown timezone falls back to UTC silently", () => {
  const r = assembleBriefing(base({ accountTimezone: "Not/A_Real_Zone" }));
  // Should not throw; falls back to UTC noon = 0.5.
  expect(r.pacing.day_fraction_elapsed).toBe(0.5);
});

test("absent accountTimezone defaults to UTC", () => {
  const r = assembleBriefing(base()); // no accountTimezone passed
  expect(r.pacing.day_fraction_elapsed).toBe(0.5);
});

test("pacing recalculates against TZ-shifted expected", () => {
  // At UTC noon, EDT is 08:00 (33% of day). Daily budget $100, today_spend
  // $33 → expected $33 → on track.
  const r = assembleBriefing(base({
    accountTimezone: "America/New_York",
    todaySpend: { spend: 33 },
    activeCampaigns: [{ id: "1", daily_budget: 10000 }],
  }));
  expect(r.pacing.status).toBe("on_track");
});

test("fatigue rows surfaced when prev window provided", () => {
  const r = assembleBriefing(base({
    adsCurrent: [{ ad_id: "1", ad_name: "A", ctr: 0.010, frequency: 4.5, cpc: 2.0 }],
    adsPrevious: [{ ad_id: "1", ad_name: "A", ctr: 0.020, frequency: 3.0, cpc: 1.0 }],
  }));
  expect(r.fatigue).toHaveLength(1);
  expect(r.fatigue[0]!.flags).toContain("ctr_decline");
});
