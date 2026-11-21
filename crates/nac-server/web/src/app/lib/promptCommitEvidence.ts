import { displayPromptFromMessageText } from "@/app/lib/format";
import type { SessionSnapshotResponse } from "@/app/types/api";

/** Proof is historical. Retire a local bubble only when its prompt is visible
 * at the verified index or has moved before the displayed system-inclusive window. */
export function promptCommitCovers(
  snapshot: SessionSnapshotResponse | null | undefined,
  runId: string | null | undefined,
  text: string | null | undefined,
): boolean {
  const proof = snapshot?.committed_prompt;
  const index = proof?.canonical_index;
  if (
    !runId ||
    text == null ||
    proof?.run_id !== runId ||
    !Number.isSafeInteger(index) ||
    index! < 0
  )
    return false;
  const start = snapshot?.message_page?.start ?? 0;
  if (start > index!) return true;
  const message = snapshot?.messages[index! - start];
  return message?.role === "user" && displayPromptFromMessageText(message.content) === text;
}
