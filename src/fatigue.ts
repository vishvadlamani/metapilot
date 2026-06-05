import type { Benchmarks } from "./config.ts";

export type AdInsight = {
  ad_id?: string;
  id?: string;
  name?: string;
  ad_name?: string;
  ctr?: number | string;
  frequency?: number | string;
  cpc?: number | string;
  impressions?: number | string;
  spend?: number | string;
  purchase_roas?: number | string;
};

export function adNameOf(row: AdInsight, fallbackId: string): string {
  return row.ad_name ?? row.name ?? fallbackId;
}

export type FatigueFlag = "ctr_decline" | "frequency_high" | "cpc_rising";

export type FatigueRow = {
  ad_id: string;
  name: string;
  flags: FatigueFlag[];
  metrics: {
    ctr_current: number | null;
    ctr_prev: number | null;
    ctr_drop_pct: number | null;
    frequency_current: number | null;
    cpc_current: number | null;
    cpc_prev: number | null;
  };
  recommendation: string;
};

function asNum(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function idOf(row: AdInsight): string | undefined {
  return row.ad_id ?? row.id;
}

function recommend(flags: readonly FatigueFlag[]): string {
  if (flags.length >= 3) return "Pause and refresh creative";
  if (flags.length === 1 && flags[0] === "frequency_high") return "Narrow audience";
  if (flags.includes("ctr_decline") || flags.includes("cpc_rising")) {
    return "Refresh creative";
  }
  return "Review";
}

export function analyzeFatigue(
  current: readonly AdInsight[],
  previous: readonly AdInsight[],
  benchmarks: Benchmarks,
): FatigueRow[] {
  const prevById = new Map<string, AdInsight>();
  for (const p of previous) {
    const id = idOf(p);
    if (id) prevById.set(id, p);
  }

  const out: FatigueRow[] = [];

  for (const c of current) {
    const id = idOf(c);
    if (!id) continue;
    const prev = prevById.get(id);

    const ctrCur = asNum(c.ctr);
    const ctrPrev = asNum(prev?.ctr);
    const freqCur = asNum(c.frequency);
    const cpcCur = asNum(c.cpc);
    const cpcPrev = asNum(prev?.cpc);

    const flags: FatigueFlag[] = [];
    let ctrDropPct: number | null = null;

    if (ctrCur !== null && ctrPrev !== null && ctrPrev > 0) {
      ctrDropPct = (ctrPrev - ctrCur) / ctrPrev;
      if (ctrDropPct >= benchmarks.ctrDropPctThreshold) {
        flags.push("ctr_decline");
      }
    }

    if (freqCur !== null && freqCur > benchmarks.maxFrequency) {
      flags.push("frequency_high");
    }

    if (
      cpcCur !== null && cpcPrev !== null &&
      ctrCur !== null && ctrPrev !== null &&
      cpcCur > cpcPrev && ctrCur < ctrPrev
    ) {
      flags.push("cpc_rising");
    }

    if (flags.length === 0) continue;

    out.push({
      ad_id: id,
      name: adNameOf(c, id),
      flags,
      metrics: {
        ctr_current: ctrCur,
        ctr_prev: ctrPrev,
        ctr_drop_pct:
          ctrDropPct !== null ? Number((ctrDropPct * 100).toFixed(2)) : null,
        frequency_current: freqCur,
        cpc_current: cpcCur,
        cpc_prev: cpcPrev,
      },
      recommendation: recommend(flags),
    });
  }

  out.sort((a, b) => {
    if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
    return (b.metrics.ctr_drop_pct ?? 0) - (a.metrics.ctr_drop_pct ?? 0);
  });

  return out;
}
