import { type ModelTurn, type TranscriptTurn } from "../../../lib/transcript";
/**
 * A transcript drawn inside the session page that is not the page's own, such
 * as a child's preview. `turns` are its snapshot turns, which keep their
 * identity across stream deltas.
 */
interface TranscriptTurnsSource {
    sessionId: string;
    turns: readonly TranscriptTurn[];
}
export declare const TranscriptTurnsContext: import("react").Context<TranscriptTurnsSource | null>;
/** The turn before `turn` in its transcript, as `partitionModelTurn` expects it. */
export declare function usePreviousTurn(turn: ModelTurn): TranscriptTurn | undefined;
/** When the prompt at this snapshot index entered the transcript, if known. */
export declare function usePromptCreatedAt(messageIndex: number | undefined): string | null;
/** The session whose transcript this is: the preview's child, else the routed session. */
export declare function useTranscriptSessionId(): string | null;
export {};
