// Which run produced which model turn.
//
// The backend captures one workspace revision per finished run and records how
// long the transcript was at that moment, so a run owns the messages between
// the previous revision's length and its own. That is the only link there is:
// nothing stores a run id per message.

import type { ModelTurn, TranscriptTurn } from "@/app/lib/transcript";
import type { WorkspaceRevision } from "@/app/types/api";

/** How a revision is named once it is no longer the working tree. */
export const revisionTitle = (ordinal: number) => `Snapshot ${ordinal}`;

/** The list arrives newest first, so the oldest revision is number one. */
export const revisionOrdinal = (index: number, total: number) => total - index;

/**
 * The revision each model turn was captured by, keyed by the turn's message
 * index, leaving out the runs that changed nothing — most of them, in a session
 * that mostly talks.
 *
 * Keyed by the message rather than by the turn so that a turn which is still
 * only a stream, and has no message to place it by, cannot read a revision at
 * all: it has nothing to look up with, whatever it happens to be keyed as.
 *
 * Walked in step rather than searched per turn so a revision is claimed once:
 * a run that finished without writing a message — a failure before the model
 * answered, or the very first capture, which carries whatever the checkout was
 * already carrying — would otherwise hand its revision to the next turn along.
 */
export function revisionsByTurn(
  turns: TranscriptTurn[],
  revisions: WorkspaceRevision[] | undefined,
): Map<number, WorkspaceRevision> {
  const result = new Map<number, WorkspaceRevision>();
  if (!revisions?.length) return result;

  // Rows captured before the backend kept the transcript length cannot be
  // placed at all, and the endpoint hands them back newest first.
  const ordered = revisions
    .filter((revision) => revision.transcript_len != null)
    .sort((a, b) => a.transcript_len! - b.transcript_len!);

  let next = 0;
  for (const turn of turns) {
    if (turn.kind !== "model") continue;
    // SAFETY: the turn's kind field was just matched, so the model variant's
    // messageIndex is present.
    const start = (turn as ModelTurn).messageIndex;
    if (start == null) continue;
    while (next < ordered.length && ordered[next].transcript_len! <= start) {
      next += 1;
    }
    if (next >= ordered.length) break;
    const revision = ordered[next];
    if (revision.changed_files > 0) result.set(start, revision);
    next += 1;
  }

  return result;
}
