import { createContext, use } from "react";
import { useParams } from "react-router-dom";

import type { ModelTurn, TranscriptTurn } from "@/app/lib/transcript";

/**
 * The transcript a row belongs to: the session page's own, or one drawn inside
 * it such as a child's preview. `turns` leave the stream out, so they keep
 * their identity across deltas and a row reading them is not re-rendered.
 */
interface TranscriptTurnsSource {
  sessionId: string;
  turns: readonly TranscriptTurn[];
}

export const TranscriptTurnsContext = createContext<TranscriptTurnsSource | null>(null);

interface TurnIndex {
  previous: ReadonlyMap<string, TranscriptTurn | undefined>;
  promptTimes: ReadonlyMap<number, string | null>;
  last: TranscriptTurn | undefined;
}

const EMPTY: readonly TranscriptTurn[] = [];
const indexes = new WeakMap<readonly TranscriptTurn[], TurnIndex>();

function indexTurns(turns: readonly TranscriptTurn[]): TurnIndex {
  const cached = indexes.get(turns);
  if (cached) return cached;
  const previous = new Map<string, TranscriptTurn | undefined>();
  const promptTimes = new Map<number, string | null>();
  turns.forEach((turn, position) => {
    previous.set(turn.key, turns[position - 1]);
    if (turn.kind === "user") promptTimes.set(turn.messageIndex, turn.createdAt);
  });
  const index = { previous, promptTimes, last: turns[turns.length - 1] };
  indexes.set(turns, index);
  return index;
}

function useSnapshotTurns(): readonly TranscriptTurn[] {
  return use(TranscriptTurnsContext)?.turns ?? EMPTY;
}

/** The turn before `turn` in its transcript, as `partitionModelTurn` expects it. */
export function usePreviousTurn(turn: ModelTurn): TranscriptTurn | undefined {
  const index = indexTurns(useSnapshotTurns());
  if (index.previous.has(turn.key)) return index.previous.get(turn.key);
  // A stream that had to open a turn of its own follows all the others.
  return turn.messageIndex === null ? index.last : undefined;
}

/** When the prompt at this snapshot index entered the transcript, if known. */
export function usePromptCreatedAt(messageIndex: number | undefined): string | null {
  const { promptTimes } = indexTurns(useSnapshotTurns());
  return messageIndex === undefined ? null : (promptTimes.get(messageIndex) ?? null);
}

/** The session whose transcript this is: the preview's child, else the routed session. */
export function useTranscriptSessionId(): string | null {
  const { sessionId } = useParams<{ sessionId: string }>();
  const source = use(TranscriptTurnsContext);
  return source ? source.sessionId : (sessionId ?? null);
}
