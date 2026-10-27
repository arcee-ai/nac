import { createContext, use } from "react";
import { useParams } from "react-router-dom";

import { TranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { STREAMING_TURN_KEY, type ModelTurn, type TranscriptTurn } from "@/app/lib/transcript";

/**
 * A transcript drawn inside the session page that is not the page's own, such
 * as a child's preview. `turns` are its snapshot turns, which keep their
 * identity across stream deltas.
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

/**
 * Snapshot turns rather than the streamed ones: rows keep reading the same
 * objects while a reply streams, so their memoized bodies stay untouched.
 */
function useSnapshotTurns(): readonly TranscriptTurn[] {
  const source = use(TranscriptTurnsContext);
  // A preview must not subscribe to the page's model, let alone read its turns.
  if (source) return source.turns;
  return use(TranscriptModelContext)?.snapshotTurns ?? EMPTY;
}

/** The turn before `turn` in its transcript, as `partitionModelTurn` expects it. */
export function usePreviousTurn(turn: ModelTurn): TranscriptTurn | undefined {
  const index = indexTurns(useSnapshotTurns());
  if (index.previous.has(turn.key)) return index.previous.get(turn.key);
  // A stream that had to open a turn of its own follows the whole snapshot.
  return turn.key === STREAMING_TURN_KEY ? index.last : undefined;
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
