/**
 * How much of an assistant turn's working is on screen by default.
 * - "compact" (default): reasoning and tools fold into one "Worked for …" line.
 * - "detailed": the activity rows are open.
 * Approvals, questions and errors are never hidden by either.
 */
export type TranscriptDensity = "compact" | "detailed";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export declare function createTranscriptDensityStore(storage?: PreferenceStorage): {
    useTranscriptDensity: () => TranscriptDensity;
    setTranscriptDensity: (density: TranscriptDensity) => void;
    toggleTranscriptDensity: () => void;
    release(): void;
};
export declare const standaloneTranscriptDensityStore: {
    useTranscriptDensity: () => TranscriptDensity;
    setTranscriptDensity: (density: TranscriptDensity) => void;
    toggleTranscriptDensity: () => void;
    release(): void;
};
export {};
