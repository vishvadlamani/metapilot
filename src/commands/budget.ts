import { previewBudget, executeBudget } from "../writes.ts";
import {
  UsageError,
  emitPreview,
  requireAdAccount,
  usdToCents,
  writeMetaResult,
  type ParsedArgs,
} from "../cli/parse.ts";

export async function run(parsed: ParsedArgs): Promise<number> {
  requireAdAccount();
  const [adsetId, usdStr] = parsed.positional;
  if (!adsetId || !usdStr) {
    throw new UsageError(
      "usage: metapilot budget <adset-id> <usd> [--yes] [--confirm-large-budget] [--first-budget]",
    );
  }
  const newCents = usdToCents(usdStr);
  if (!parsed.flags.has("--yes")) {
    emitPreview(await previewBudget(adsetId, newCents));
    return 0;
  }
  return writeMetaResult(
    await executeBudget(
      adsetId,
      newCents,
      parsed.flags.has("--confirm-large-budget"),
      parsed.flags.has("--first-budget"),
    ),
  );
}
