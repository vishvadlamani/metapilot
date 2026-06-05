import { previewStatusChange, executeStatusChange } from "../writes.ts";
import {
  emitPreview,
  parseKindId,
  requireAdAccount,
  writeMetaResult,
  type ParsedArgs,
} from "../cli/parse.ts";

export async function run(parsed: ParsedArgs): Promise<number> {
  requireAdAccount();
  const { kind, id, flags } = parseKindId(parsed, "pause");
  if (!flags.has("--yes")) {
    emitPreview(await previewStatusChange(kind, id, "PAUSED"));
    return 0;
  }
  return writeMetaResult(await executeStatusChange(kind, id, "PAUSED", false));
}
