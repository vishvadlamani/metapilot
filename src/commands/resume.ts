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
  const { kind, id, flags } = parseKindId(parsed, "resume");
  if (!flags.has("--yes")) {
    emitPreview(await previewStatusChange(kind, id, "ACTIVE"));
    return 0;
  }
  // Double-confirmation is enforced in safety.ts (claimWriteSlot); we just
  // pass the flag through.
  return writeMetaResult(
    await executeStatusChange(kind, id, "ACTIVE", flags.has("--confirm-activate")),
  );
}
