import { fetchInsights, AD_INSIGHT_FIELDS } from "../insights.ts";
import { analyzeFatigue, type AdInsight } from "../fatigue.ts";
import { loadBenchmarks } from "../config.ts";
import { unwrapArray } from "../meta-cli.ts";
import { nDayWindow, fmtYmd } from "../time.ts";
import { requireAdAccount } from "../cli/parse.ts";

export async function run(): Promise<number> {
  requireAdAccount();
  const now = new Date();
  const cur = nDayWindow(now, 7, 1);
  const prev = nDayWindow(now, 7, 8);

  const [curR, prevR] = await Promise.all([
    fetchInsights({
      timeRange: { since: fmtYmd(cur.since), until: fmtYmd(cur.until) },
      fields: AD_INSIGHT_FIELDS,
    }),
    fetchInsights({
      timeRange: { since: fmtYmd(prev.since), until: fmtYmd(prev.until) },
      fields: AD_INSIGHT_FIELDS,
    }),
  ]);

  if (curR.exitCode !== 0 || prevR.exitCode !== 0) {
    if (curR.stderr) process.stderr.write(curR.stderr);
    if (prevR.stderr) process.stderr.write(prevR.stderr);
    return Math.max(curR.exitCode, prevR.exitCode);
  }

  const benchmarks = await loadBenchmarks();
  const fatigued = analyzeFatigue(
    unwrapArray<AdInsight>(curR.parsed),
    unwrapArray<AdInsight>(prevR.parsed),
    benchmarks,
  );
  process.stdout.write(
    JSON.stringify({ window_days: 7, fatigued }, null, 2) + "\n",
  );
  return 0;
}
