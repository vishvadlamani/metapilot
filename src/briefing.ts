import { analyzeFatigue, adNameOf, type AdInsight, type FatigueRow } from "./fatigue.ts";
import type { CampaignInsight, CampaignBudget } from "./budget-recs.ts";
import type { Benchmarks } from "./config.ts";

export type AccountInsightRow = {
  spend?: number | string;
};

export type PacingStatus = "on_track" | "underpacing" | "overpacing" | "unknown";

export type Pacing = {
  today_spend_usd: number | null;
  active_daily_budget_usd: number;
  day_fraction_elapsed: number;
  expected_spend_usd: number;
  status: PacingStatus;
  delta_pct: number | null;
};

export type ActiveCampaignSummary = {
  id: string;
  name: string;
  daily_budget_usd: number | null;
  status: string;
};

export type CampaignPerf = {
  campaign_id: string;
  name: string;
  spend_usd: number;
  ctr: number | null;
  cpc: number | null;
  roas: number | null;
  cpa_usd: number | null;
};

export type AdLeader = {
  ad_id: string;
  name: string;
  spend_usd: number;
  roas: number | null;
  ctr: number | null;
};

export type BriefingReport = {
  generated_at: string;
  pacing: Pacing;
  active_campaigns: ActiveCampaignSummary[];
  performance_7d: CampaignPerf[];
  ad_leaders: { top: AdLeader[]; bottom: AdLeader[] };
  fatigue: FatigueRow[];
};

export type BriefingInputs = {
  todaySpend: AccountInsightRow;
  activeCampaigns: readonly CampaignBudget[];
  weekly: readonly CampaignInsight[];
  adsCurrent: readonly AdInsight[];
  adsPrevious: readonly AdInsight[];
  benchmarks: Benchmarks;
  // IANA timezone for the ad account's billing day. Defaults to UTC. Bad
  // values fall back to UTC silently (so a typo doesn't break the briefing).
  accountTimezone?: string;
  // Test override; defaults to Date.now().
  nowMs?: number;
};

// Tolerance bands for pacing status. Spend within ±15% of expected = on track.
const ON_TRACK_BAND = 0.15;
const LEADER_COUNT = 5;
const MIN_SPEND_FOR_LEADER = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

function asNum(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Day fraction elapsed in the given IANA timezone. Uses Intl.DateTimeFormat
 * to extract local h/m/s — avoids fighting Date's UTC-only millisecond model.
 *
 * Bad/unknown TZ silently falls back to UTC (Intl throws RangeError on
 * unknown TZ; we catch and degrade to keep the briefing functional).
 */
function dayFractionElapsed(nowMs: number, timeZone = "UTC"): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(nowMs));
    const pick = (t: string): number => {
      const p = parts.find((x) => x.type === t);
      return p ? parseInt(p.value, 10) : 0;
    };
    // Some locales emit "24" instead of "00" for midnight; normalize.
    const h = pick("hour") % 24;
    const m = pick("minute");
    const s = pick("second");
    return (h * 3600 + m * 60 + s) / 86400;
  } catch {
    // Unknown timezone — fall back to UTC.
    const d = new Date(nowMs);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return (nowMs - midnight) / DAY_MS;
  }
}

function campaignIdOf(c: CampaignBudget | CampaignInsight): string {
  return c.campaign_id ?? c.id ?? "";
}

export function assembleBriefing(inputs: BriefingInputs): BriefingReport {
  const now = inputs.nowMs ?? Date.now();
  const generated = new Date(now).toISOString();

  const todaySpend = asNum(inputs.todaySpend.spend);
  let activeBudgetUsd = 0;
  for (const c of inputs.activeCampaigns) {
    const cents = asNum(c.daily_budget);
    if (cents !== null) activeBudgetUsd += cents / 100;
  }
  const dayFrac = dayFractionElapsed(now, inputs.accountTimezone);
  const expected = activeBudgetUsd * dayFrac;

  let pacingStatus: PacingStatus = "unknown";
  let deltaPct: number | null = null;
  if (todaySpend !== null && expected > 0) {
    deltaPct = (todaySpend - expected) / expected;
    if (Math.abs(deltaPct) < ON_TRACK_BAND) pacingStatus = "on_track";
    else if (deltaPct > 0) pacingStatus = "overpacing";
    else pacingStatus = "underpacing";
  }

  const pacing: Pacing = {
    today_spend_usd: todaySpend,
    active_daily_budget_usd: Number(activeBudgetUsd.toFixed(2)),
    day_fraction_elapsed: Number(dayFrac.toFixed(3)),
    expected_spend_usd: Number(expected.toFixed(2)),
    status: pacingStatus,
    delta_pct: deltaPct !== null ? Number(deltaPct.toFixed(3)) : null,
  };

  const active_campaigns: ActiveCampaignSummary[] = inputs.activeCampaigns
    .map((c) => {
      const cents = asNum(c.daily_budget);
      return {
        id: campaignIdOf(c),
        name: c.name ?? campaignIdOf(c),
        daily_budget_usd: cents !== null ? cents / 100 : null,
        status: "ACTIVE",
      };
    })
    .filter((c) => c.id);

  const performance_7d: CampaignPerf[] = inputs.weekly
    .map((row) => ({
      campaign_id: campaignIdOf(row),
      name: row.campaign_name ?? row.name ?? campaignIdOf(row),
      spend_usd: asNum(row.spend) ?? 0,
      ctr: asNum(row.ctr),
      cpc: asNum(row.cpc),
      roas: asNum(row.purchase_roas),
      cpa_usd: asNum(row.cost_per_result),
    }))
    .filter((r) => r.campaign_id)
    .sort((a, b) => b.spend_usd - a.spend_usd);

  const adRows: AdLeader[] = inputs.adsCurrent
    .map((row) => {
      const id = row.ad_id ?? row.id ?? "";
      return {
        ad_id: id,
        name: adNameOf(row, id),
        spend_usd: asNum(row.spend) ?? 0,
        roas: asNum(row.purchase_roas),
        ctr: asNum(row.ctr),
      };
    })
    .filter((r) => r.ad_id && r.spend_usd >= MIN_SPEND_FOR_LEADER);

  const top = [...adRows]
    .sort((a, b) => (b.roas ?? -Infinity) - (a.roas ?? -Infinity))
    .slice(0, LEADER_COUNT);
  const bottom = [...adRows]
    .sort((a, b) => (a.roas ?? Infinity) - (b.roas ?? Infinity))
    .slice(0, LEADER_COUNT);

  const fatigue = analyzeFatigue(
    inputs.adsCurrent,
    inputs.adsPrevious,
    inputs.benchmarks,
  );

  return {
    generated_at: generated,
    pacing,
    active_campaigns,
    performance_7d,
    ad_leaders: { top, bottom },
    fatigue,
  };
}
