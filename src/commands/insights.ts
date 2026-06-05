import { fetchInsights, isInsightsKind } from "../insights.ts";
import {
  UsageError,
  requireAdAccount,
  splitCsv,
  strFlag,
  writeMetaResult,
  type ParsedArgs,
} from "../cli/parse.ts";

export async function run(parsed: ParsedArgs): Promise<number> {
  requireAdAccount();
  const [id] = parsed.positional;

  const kindStr = strFlag(parsed.flags, "--kind");
  if (kindStr !== undefined && !isInsightsKind(kindStr)) {
    throw new UsageError(
      `invalid --kind: ${kindStr} (must be campaign|adset|ad)`,
    );
  }

  return writeMetaResult(
    await fetchInsights({
      id,
      kind: kindStr,
      datePreset: strFlag(parsed.flags, "--since"),
      fields: splitCsv(strFlag(parsed.flags, "--fields")),
      breakdowns: splitCsv(strFlag(parsed.flags, "--breakdowns")),
    }),
  );
}
