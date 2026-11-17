import type { ModelTurn, TranscriptTurn } from "../../../lib/transcript";
/**
 * The transcript a row belongs to: the session page's own, or one drawn inside
 * it such as a child's preview. `turns` leave the stream out, so they keep
 * their identity across deltas and a row reading them is not re-rendered.
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
