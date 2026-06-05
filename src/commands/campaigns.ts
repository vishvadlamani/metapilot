import { runMeta } from "../meta-cli.ts";
import { requireAdAccount, writeMetaResult } from "../cli/parse.ts";

// Real `meta ads campaign list` has no --status filter; post-filtering for
// ACTIVE happens in analyzers / formatters when needed.
export async function run(): Promise<number> {
  requireAdAccount();
  return writeMetaResult(
    await runMeta(["ads", "campaign", "list"], { mutating: false }),
  );
}
