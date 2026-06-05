import { runMeta, type MetaResult } from "./meta-cli.ts";

export type InsightsKind = "campaign" | "adset" | "ad";

export const INSIGHTS_KINDS: readonly InsightsKind[] = ["campaign", "adset", "ad"];

// Real meta CLI defaults to `spend,impressions,clicks,ctr,cpc,reach` but our
// dashboard needs conversions + ROAS-style fields too. Override explicitly.
export const DEFAULT_FIELDS: readonly string[] = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
  "cost_per_result",
  "purchase_roas",
];

export const DEFAULT_DATE_PRESET = "last_7d";

// Field sets used by analyzers. Hoisted here so fatigue/briefing/budget-recs
// stay aligned on what they request from the Marketing API.
export const AD_INSIGHT_FIELDS: readonly string[] = [
  "ad_id",
  "ad_name",
  "ctr",
  "frequency",
  "cpc",
  "impressions",
  "spend",
  "purchase_roas",
];

export const CAMPAIGN_INSIGHT_FIELDS: readonly string[] = [
  "campaign_id",
  "campaign_name",
  "spend",
  "ctr",
  "cpc",
  "purchase_roas",
  "cost_per_result",
  "conversions",
];

// Valid presets per `meta ads insights get --date-preset` enum.
export const VALID_DATE_PRESETS: readonly string[] = [
  "today",
  "yesterday",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
];

export type InsightsTimeRange = {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
};

export type InsightsOptions = {
  id?: string;
  kind?: InsightsKind;
  datePreset?: string;
  timeRange?: InsightsTimeRange;
  fields?: readonly string[];
  breakdowns?: readonly string[];
};

export function isInsightsKind(v: string): v is InsightsKind {
  return (INSIGHTS_KINDS as readonly string[]).includes(v);
}

// Build the argv chain for `meta ads insights get ...`. Public for testing.
export function buildInsightsArgs(opts: InsightsOptions): string[] {
  const args: string[] = ["ads", "insights", "get"];

  if (opts.id) {
    const kind = opts.kind ?? "campaign";
    args.push(`--${kind}-id`, opts.id);
  }

  if (opts.timeRange) {
    args.push("--since", opts.timeRange.since, "--until", opts.timeRange.until);
  } else {
    args.push("--date-preset", opts.datePreset ?? DEFAULT_DATE_PRESET);
  }

  args.push("--fields", (opts.fields ?? DEFAULT_FIELDS).join(","));

  for (const b of opts.breakdowns ?? []) {
    args.push("--breakdown", b);
  }

  return args;
}

export async function fetchInsights(opts: InsightsOptions): Promise<MetaResult> {
  return runMeta(buildInsightsArgs(opts), { mutating: false });
}
