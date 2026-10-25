import type { TranscriptTurn } from "@/app/lib/transcript";

/** Turns as they were last drawn, with the window their indexes were read in. */
export interface DrawnTurns {
  turns: readonly TranscriptTurn[];
  windowStart: number;
}

interface KeyedSpan {
  from: number;
  to: number;
  key: string;
}

/**
 * The messages each committed model turn spans. A turn starts right after the
 * turn before it, or at the window's edge, and ends at its newest message.
 */
function modelSpans({ turns, windowStart }: DrawnTurns): KeyedSpan[] {
  const spans: KeyedSpan[] = [];
  let from = windowStart;
  for (const turn of turns) {
    if (turn.messageIndex == null) continue;
    if (turn.kind === "model") spans.push({ from, to: turn.messageIndex, key: turn.key });
    from = turn.messageIndex + 1;
  }
  return spans;
}

/**
 * Key every committed model turn by the first message it spans, unless it
 * overlaps a turn already drawn, whose key it keeps. A reply grows at its end
 * while it runs, and a refetch can cut its start off the message window, or a
 * page of older messages can extend it; keyed by either edge alone, the whole
 * message would remount, its code blocks repainting before they highlight.
 *
 * The first key is also the one a stream is drawn under before anything of the
 * reply is committed: the message right after the prompt it answers.
 */
export function keepTurnKeys(
  turns: TranscriptTurn[],
  windowStart: number,
  drawn: DrawnTurns | null,
): TranscriptTurn[] {
  const spans = drawn ? modelSpans(drawn) : [];
  const used = new Set<string>();
  let cursor = 0;
  let from = windowStart;
  return turns.map((turn) => {
    if (turn.messageIndex == null) return turn;
    const start = from;
    from = turn.messageIndex + 1;
    if (turn.kind !== "model") return turn;
    while (cursor < spans.length && spans[cursor].to < start) cursor += 1;
    const span = spans[cursor];
    const overlapping = span && span.from <= turn.messageIndex && !used.has(span.key);
    let key = overlapping ? span.key : `model-${start}`;
    if (used.has(key)) key = `model-${start}-${turn.messageIndex}`;
    used.add(key);
    return key === turn.key ? turn : { ...turn, key };
  });
}

/** Key of the model turn that will answer whatever the last turn asked. */
export function replyKey(turns: readonly TranscriptTurn[], windowStart: number): string {
  const last = turns[turns.length - 1];
  return `model-${(last?.messageIndex ?? windowStart - 1) + 1}`;
}
