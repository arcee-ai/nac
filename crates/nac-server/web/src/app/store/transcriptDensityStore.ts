import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

/**
 * How much of an assistant turn's working is on screen by default.
 * - "compact" (default): reasoning and tools fold into one "Worked for …" line.
 * - "detailed": the activity rows are open.
 * Approvals, questions and errors are never hidden by either.
 */
export type TranscriptDensity = "compact" | "detailed";

const KEY = "nac.transcriptDensity";

function read(storage: PreferenceStorage | undefined): TranscriptDensity {
  try {
    return storage?.getItem(KEY) === "detailed" ? "detailed" : "compact";
  } catch {
    return "compact";
  }
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function createTranscriptDensityStore(storage?: PreferenceStorage) {
  const densityStore = createStore<{ density: TranscriptDensity }>(
    { density: read(storage) },
    "transcriptDensity",
  );
  let closed = false;
  const setTranscriptDensity = (density: TranscriptDensity) => {
    if (closed) return;
    densityStore.setState({ density });
    try {
      storage?.setItem(KEY, density);
    } catch {
      /* Preferences are optional. */
    }
  };
  return {
    useTranscriptDensity: () => densityStore.useStore((state) => state.density),
    setTranscriptDensity,
    toggleTranscriptDensity: () =>
      setTranscriptDensity(densityStore.getState().density === "compact" ? "detailed" : "compact"),
    release() {
      closed = true;
      densityStore.setState({ density: "compact" });
    },
  };
}

export const standaloneTranscriptDensityStore = createTranscriptDensityStore(
  standalonePreferenceStorage,
);
