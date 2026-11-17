import type { TranscriptModel } from "./useTranscriptModel";
export declare const TranscriptModelContext: import("react").Context<TranscriptModel | null>;
/** The session page's transcript model, the one derivation the chat and Insights share. */
export declare function useTranscriptModelContext(): TranscriptModel;
