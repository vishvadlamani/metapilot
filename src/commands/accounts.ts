import { runMeta } from "../meta-cli.ts";
import { writeMetaResult } from "../cli/parse.ts";

export async function run(): Promise<number> {
  return writeMetaResult(
    await runMeta(["ads", "adaccount", "list"], { mutating: false }),
  );
}
