import { createContext, useContext } from "react";

import type { TranscriptModel } from "@/app/components/inspector/transcript/useTranscriptModel";

export const TranscriptModelContext = createContext<TranscriptModel | null>(null);

/** The session page's transcript model, the one derivation the chat and Insights share. */
export function useTranscriptModelContext(): TranscriptModel {
  const model = useContext(TranscriptModelContext);
  if (model == null) {
    throw new Error("useTranscriptModelContext must be used inside a TranscriptModelProvider");
  }
  return model;
}
