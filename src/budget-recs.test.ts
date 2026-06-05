import { test, expect } from "bun:test";
import { analyzeBudgets, type CampaignInsight, type CampaignBudget } from "./budget-recs.ts";
import type { Benchmarks } from "./config.ts";

const BENCH: Benchmarks = {
  targetCpaCents: 3000,
  minCtr: 0.01,
  maxFrequency: 3.5,
  ctrDropPctThreshold: 0.20,
  minRoas: 2.0,
};

test("empty inputs return empty result", () => {
  const r = analyzeBudgets([], [], BENCH);
  expect(r.winners).toEqual([]);
  expect(r.bleeders).toEqual([]);
  expect(r.recommendations).toEqual([]);
});

test("tiny spend ignored (under MIN_SPEND_USD_FOR_SIGNAL)", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "1", name: "A", spend: 10, purchase_roas: 5.0, ctr: 0.02 },
  ];
  const r = analyzeBudgets(ins, [], BENCH);
  expect(r.winners).toEqual([]);
  expect(r.bleeders).toEqual([]);
});

test("strong roas with spend → winner", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "1", name: "A", spend: 100, purchase_roas: 3.0, ctr: 0.02 },
  ];
  const r = analyzeBudgets(ins, [], BENCH);
  expect(r.winners).toHaveLength(1);
  expect(r.winners[0]!.roas).toBe(3.0);
});

test("budget_capped true when avg daily spend ≥ 85% of daily_budget", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "1", name: "A", spend: 700, purchase_roas: 3.0 },
  ];
  const budgets: CampaignBudget[] = [
    { id: "1", daily_budget: 10000 }, // $100/day → 7d cap $700; spend $700 = 100%
  ];
  const r = analyzeBudgets(ins, budgets, BENCH);
  expect(r.winners[0]!.budget_capped).toBe(true);
});

test("high cpa flags bleeder", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "1", name: "A", spend: 200, cost_per_result: 50, ctr: 0.02 },
  ];
  const r = analyzeBudgets(ins, [], BENCH);
  expect(r.bleeders[0]!.issues).toContain("high_cpa");
});

test("low ctr + low roas + high cpa → three issues, ranked first", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "low1", name: "L", spend: 100, purchase_roas: 1.5, cost_per_result: 10, ctr: 0.02 },
    { campaign_id: "low3", name: "T", spend: 200, purchase_roas: 0.5, cost_per_result: 50, ctr: 0.005 },
  ];
  const r = analyzeBudgets(ins, [], BENCH);
  expect(r.bleeders[0]!.campaign_id).toBe("low3");
  expect(r.bleeders[0]!.issues.length).toBe(3);
});

test("pairs top bleeder with top winner into shift recommendation", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "win", name: "W", spend: 350, purchase_roas: 4.0 },
    { campaign_id: "loss", name: "L", spend: 200, purchase_roas: 0.5, cost_per_result: 50 },
  ];
  const budgets: CampaignBudget[] = [
    { id: "win", daily_budget: 5000 }, // $50/day
    { id: "loss", daily_budget: 4000 }, // $40/day
  ];
  const r = analyzeBudgets(ins, budgets, BENCH);
  expect(r.recommendations).toHaveLength(1);
  const rec = r.recommendations[0]!;
  expect(rec.from_id).toBe("loss");
  expect(rec.to_id).toBe("win");
  expect(rec.amount_usd).toBe(20); // 50% of $40
  expect(rec.projected_revenue_uplift_usd).toBe(80); // 20 * 4.0 ROAS
});

test("no shift rec when bleeder has no known budget", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "win", name: "W", spend: 350, purchase_roas: 4.0 },
    { campaign_id: "loss", name: "L", spend: 200, purchase_roas: 0.5, cost_per_result: 50 },
  ];
  const r = analyzeBudgets(ins, [], BENCH); // budgets list empty
  expect(r.recommendations).toEqual([]);
});

test("capped winner prioritized over uncapped with same/higher roas", () => {
  const ins: CampaignInsight[] = [
    { campaign_id: "capped", name: "C", spend: 700, purchase_roas: 3.0 },
    { campaign_id: "free", name: "F", spend: 100, purchase_roas: 5.0 },
  ];
  const budgets: CampaignBudget[] = [
    { id: "capped", daily_budget: 10000 }, // $100 → capped
    { id: "free", daily_budget: 100000 },   // $1000 → not capped
  ];
  const r = analyzeBudgets(ins, budgets, BENCH);
  expect(r.winners[0]!.campaign_id).toBe("capped");
});
