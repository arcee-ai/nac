import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

/**
 * How much of an assistant turn's working is on screen by default.
 * - "compact" (default): reasoning and tools fold into one "Worked for …" line.
 * - "detailed": the activity rows are open.
 * Approvals, questions and errors are never hidden by either.
 */
export type TranscriptDensity = "compact" | "detailed";

const KEY = "nac.transcriptDensity";

function read(): TranscriptDensity {
  try {
    return standalonePreferenceStorage.getItem(KEY) === "detailed" ? "detailed" : "compact";
  } catch {
    return "compact";
  }
}

const densityStore = createStore<{ density: TranscriptDensity }>(
  { density: read() },
  "transcriptDensity",
);

export function useTranscriptDensity(): TranscriptDensity {
  return densityStore.useStore((state) => state.density);
}

export function setTranscriptDensity(density: TranscriptDensity): void {
  densityStore.setState({ density });
  try {
    standalonePreferenceStorage.setItem(KEY, density);
  } catch {
    // Preference storage is best-effort.
  }
}

export function toggleTranscriptDensity(): void {
  setTranscriptDensity(densityStore.getState().density === "compact" ? "detailed" : "compact");
}
