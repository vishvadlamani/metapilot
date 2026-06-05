import type { Benchmarks } from "./config.ts";

export type CampaignInsight = {
  campaign_id?: string;
  id?: string;
  name?: string;
  campaign_name?: string;
  spend?: number | string;
  ctr?: number | string;
  cpc?: number | string;
  purchase_roas?: number | string;
  cost_per_result?: number | string;
  conversions?: number | string;
};

export type CampaignBudget = {
  id?: string;
  campaign_id?: string;
  name?: string;
  daily_budget?: number | string;
};

export type WinnerRow = {
  campaign_id: string;
  name: string;
  spend_usd: number;
  roas: number;
  daily_budget_usd: number | null;
  budget_capped: boolean;
};

export type BleederIssue = "low_roas" | "high_cpa" | "low_ctr";

export type BleederRow = {
  campaign_id: string;
  name: string;
  spend_usd: number;
  roas: number | null;
  cpa_usd: number | null;
  daily_budget_usd: number | null;
  issues: BleederIssue[];
};

export type ShiftRec = {
  action: "shift_budget";
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount_usd: number;
  projected_revenue_uplift_usd: number | null;
  note: string;
};

export type BudgetRecommendations = {
  window_days: number;
  winners: WinnerRow[];
  bleeders: BleederRow[];
  recommendations: ShiftRec[];
};

const MIN_SPEND_USD_FOR_SIGNAL = 50;
const CAPPED_RATIO = 0.85;
const SHIFT_FRACTION = 0.5;

function asNum(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function idOf(row: { campaign_id?: string; id?: string }): string | undefined {
  return row.campaign_id ?? row.id;
}

function nameOf(row: {
  name?: string;
  campaign_name?: string;
  campaign_id?: string;
  id?: string;
}): string {
  return row.campaign_name ?? row.name ?? idOf(row) ?? "(unknown)";
}

export function analyzeBudgets(
  insights: readonly CampaignInsight[],
  budgets: readonly CampaignBudget[],
  benchmarks: Benchmarks,
  windowDays = 7,
): BudgetRecommendations {
  const budgetById = new Map<string, number>();
  for (const b of budgets) {
    const id = idOf(b);
    const cents = asNum(b.daily_budget);
    if (id && cents !== null) budgetById.set(id, cents);
  }

  const winners: WinnerRow[] = [];
  const bleeders: BleederRow[] = [];

  for (const row of insights) {
    const id = idOf(row);
    if (!id) continue;
    const spend = asNum(row.spend);
    if (spend === null || spend < MIN_SPEND_USD_FOR_SIGNAL) continue;

    const roas = asNum(row.purchase_roas);
    const cpa = asNum(row.cost_per_result);
    const ctr = asNum(row.ctr);
    const dailyBudgetCents = budgetById.get(id);
    const dailyBudgetUsd =
      dailyBudgetCents !== undefined ? dailyBudgetCents / 100 : null;

    let capped = false;
    if (dailyBudgetUsd !== null && dailyBudgetUsd > 0) {
      capped = spend / windowDays >= dailyBudgetUsd * CAPPED_RATIO;
    }

    if (roas !== null && roas >= benchmarks.minRoas) {
      winners.push({
        campaign_id: id,
        name: nameOf(row),
        spend_usd: spend,
        roas,
        daily_budget_usd: dailyBudgetUsd,
        budget_capped: capped,
      });
    }

    const issues: BleederIssue[] = [];
    if (roas !== null && roas < benchmarks.minRoas / 2) issues.push("low_roas");
    if (cpa !== null && cpa * 100 > benchmarks.targetCpaCents) issues.push("high_cpa");
    if (ctr !== null && ctr < benchmarks.minCtr) issues.push("low_ctr");
    if (issues.length > 0) {
      bleeders.push({
        campaign_id: id,
        name: nameOf(row),
        spend_usd: spend,
        roas,
        cpa_usd: cpa,
        daily_budget_usd: dailyBudgetUsd,
        issues,
      });
    }
  }

  winners.sort((a, b) => {
    if (a.budget_capped !== b.budget_capped) return a.budget_capped ? -1 : 1;
    return b.roas - a.roas;
  });

  bleeders.sort((a, b) => {
    if (b.issues.length !== a.issues.length) return b.issues.length - a.issues.length;
    return b.spend_usd - a.spend_usd;
  });

  const recommendations: ShiftRec[] = [];
  const topWinner = winners.find((w) => w.budget_capped) ?? winners[0];
  const topBleeder = bleeders[0];

  if (
    topWinner &&
    topBleeder &&
    topWinner.campaign_id !== topBleeder.campaign_id &&
    topBleeder.daily_budget_usd !== null &&
    topBleeder.daily_budget_usd > 0
  ) {
    const amountUsd = Math.max(
      1,
      Math.round(topBleeder.daily_budget_usd * SHIFT_FRACTION),
    );
    const projected = Number((amountUsd * topWinner.roas).toFixed(2));
    const winnerBudget = topWinner.daily_budget_usd;
    const note =
      winnerBudget === null
        ? `Winner's current daily budget unknown — verify before increasing. Decrease bleeder from $${topBleeder.daily_budget_usd.toFixed(2)} to $${(topBleeder.daily_budget_usd - amountUsd).toFixed(2)}.`
        : `Increase winner from $${winnerBudget.toFixed(2)} to $${(winnerBudget + amountUsd).toFixed(2)} daily; decrease bleeder from $${topBleeder.daily_budget_usd.toFixed(2)} to $${(topBleeder.daily_budget_usd - amountUsd).toFixed(2)}.`;

    recommendations.push({
      action: "shift_budget",
      from_id: topBleeder.campaign_id,
      from_name: topBleeder.name,
      to_id: topWinner.campaign_id,
      to_name: topWinner.name,
      amount_usd: amountUsd,
      projected_revenue_uplift_usd: projected,
      note,
    });
  }

  return { window_days: windowDays, winners, bleeders, recommendations };
}
