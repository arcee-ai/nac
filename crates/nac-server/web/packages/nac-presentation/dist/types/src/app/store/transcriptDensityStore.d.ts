/**
 * How much of an assistant turn's working is on screen by default.
 * - "compact" (default): reasoning and tools fold into one "Worked for …" line.
 * - "detailed": the activity rows are open.
 * Approvals, questions and errors are never hidden by either.
 */
export type TranscriptDensity = "compact" | "detailed";
export declare function useTranscriptDensity(): TranscriptDensity;
export declare function setTranscriptDensity(density: TranscriptDensity): void;
export declare function toggleTranscriptDensity(): void;
