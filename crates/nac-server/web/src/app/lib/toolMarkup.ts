/**
 * Hermes / Llama native tool-call XML that thinking models sometimes leak into
 * reasoning or prose instead of the structured `tool_calls` channel. Same tag
 * family the backend strips before history is sent back to the model.
 */
const NATIVE_TOOL_TAG_NAMES = [
  "parameter",
  "tool_use",
  "tool_call",
  "tool_name",
  "invoke",
  "arguments",
  "parameters",
  "function",
] as const;

const NATIVE_TOOL_TAG = NATIVE_TOOL_TAG_NAMES.join("|");

const PAIRED_NATIVE_TOOL_TAG = new RegExp(
  `<(${NATIVE_TOOL_TAG})\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
  "gi",
);

const STRAY_NATIVE_TOOL_TAG = new RegExp(
  `<\\/?(?:${NATIVE_TOOL_TAG})\\b[^>]*>`,
  "gi",
);

/** Drops leaked native tool-call markup so Thoughts / prose stay readable. */
export function stripNativeToolMarkup(text: string): string {
  if (!text.includes("<")) return text;

  let cleaned = text;
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    PAIRED_NATIVE_TOOL_TAG.lastIndex = 0;
    cleaned = cleaned.replace(PAIRED_NATIVE_TOOL_TAG, "");
  }
  STRAY_NATIVE_TOOL_TAG.lastIndex = 0;
  cleaned = cleaned.replace(STRAY_NATIVE_TOOL_TAG, "");
  return cleaned;
}
