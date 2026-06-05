import {
  fetchInsights,
  AD_INSIGHT_FIELDS,
  CAMPAIGN_INSIGHT_FIELDS,
} from "../insights.ts";
import { assembleBriefing, type AccountInsightRow } from "../briefing.ts";
import type { AdInsight } from "../fatigue.ts";
import type { CampaignInsight, CampaignBudget } from "../budget-recs.ts";
import { loadBenchmarks, loadPreferences } from "../config.ts";
import { runMeta, unwrapArray } from "../meta-cli.ts";
import { nDayWindow, fmtYmd } from "../time.ts";
import { requireAdAccount } from "../cli/parse.ts";

export async function run(): Promise<number> {
  requireAdAccount();
  const now = new Date();
  const week = nDayWindow(now, 7, 1);
  const prevWeek = nDayWindow(now, 7, 8);

  const [todayR, activeR, weeklyR, adsCurR, adsPrevR] = await Promise.all([
    fetchInsights({ datePreset: "today", fields: ["spend"] }),
    runMeta(["ads", "campaign", "list"], { mutating: false }),
    fetchInsights({
      timeRange: { since: fmtYmd(week.since), until: fmtYmd(week.until) },
      fields: CAMPAIGN_INSIGHT_FIELDS,
    }),
    fetchInsights({
      timeRange: { since: fmtYmd(week.since), until: fmtYmd(week.until) },
      fields: AD_INSIGHT_FIELDS,
    }),
    fetchInsights({
      timeRange: { since: fmtYmd(prevWeek.since), until: fmtYmd(prevWeek.until) },
      fields: AD_INSIGHT_FIELDS,
    }),
  ]);

  const fetches = [todayR, activeR, weeklyR, adsCurR, adsPrevR];
  const failed = fetches.find((r) => r.exitCode !== 0);
  if (failed) {
    for (const r of fetches) {
      if (r.stderr) process.stderr.write(r.stderr);
    }
    return failed.exitCode;
  }

  const [benchmarks, preferences] = await Promise.all([
    loadBenchmarks(),
    loadPreferences(),
  ]);
  const todayRows = unwrapArray<AccountInsightRow>(todayR.parsed);

  const report = assembleBriefing({
    todaySpend: todayRows[0] ?? {},
    activeCampaigns: unwrapArray<CampaignBudget>(activeR.parsed),
    weekly: unwrapArray<CampaignInsight>(weeklyR.parsed),
    adsCurrent: unwrapArray<AdInsight>(adsCurR.parsed),
    adsPrevious: unwrapArray<AdInsight>(adsPrevR.parsed),
    benchmarks,
    accountTimezone: preferences.accountTimezone,
  });

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return 0;
}
