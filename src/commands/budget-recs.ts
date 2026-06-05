import { fetchInsights, CAMPAIGN_INSIGHT_FIELDS } from "../insights.ts";
import {
  analyzeBudgets,
  type CampaignInsight,
  type CampaignBudget,
} from "../budget-recs.ts";
import { loadBenchmarks } from "../config.ts";
import { runMeta, unwrapArray } from "../meta-cli.ts";
import { nDayWindow, fmtYmd } from "../time.ts";
import { requireAdAccount } from "../cli/parse.ts";

const WINDOW_DAYS = 7;

export async function run(): Promise<number> {
  requireAdAccount();
  const win = nDayWindow(new Date(), WINDOW_DAYS, 1);

  const [insightsR, campaignsR] = await Promise.all([
    fetchInsights({
      timeRange: { since: fmtYmd(win.since), until: fmtYmd(win.until) },
      fields: CAMPAIGN_INSIGHT_FIELDS,
    }),
    // Real `campaign list` has no --fields flag; uses Marketing API defaults.
    runMeta(["ads", "campaign", "list"], { mutating: false }),
  ]);

  if (insightsR.exitCode !== 0 || campaignsR.exitCode !== 0) {
    if (insightsR.stderr) process.stderr.write(insightsR.stderr);
    if (campaignsR.stderr) process.stderr.write(campaignsR.stderr);
    return Math.max(insightsR.exitCode, campaignsR.exitCode);
  }

  const benchmarks = await loadBenchmarks();
  const recs = analyzeBudgets(
    unwrapArray<CampaignInsight>(insightsR.parsed),
    unwrapArray<CampaignBudget>(campaignsR.parsed),
    benchmarks,
    WINDOW_DAYS,
  );
  process.stdout.write(JSON.stringify(recs, null, 2) + "\n");
  return 0;
}
