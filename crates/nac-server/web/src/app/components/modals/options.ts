import type { SelectItem } from "@/app/atoms";
import { CLEAR_EFFORT } from "@/app/lib/modelConfig";

// Backend and reasoning-effort choices mirror nac-core's serde enums
// (BackendKind = kebab-case, ReasoningEffort = lowercase).
export const BACKEND_OPTIONS: SelectItem[] = [
  { id: "", label: "Inherit config" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "chatgpt-codex-responses", label: "ChatGPT Codex Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "fireworks-chat", label: "Fireworks Chat" },
  { id: "together-chat", label: "Together Chat" },
  { id: "arcee-auth", label: "Arcee (stored login)" },
  { id: "arcee-api", label: "Arcee API" },
];

export const REASONING_OPTIONS: SelectItem[] = [
  { id: "", label: "Inherit config" },
  { id: CLEAR_EFFORT, label: "Clear configured effort" },
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X-High" },
];

export const CREDENTIAL_OPTIONS: SelectItem[] = [
  { id: "inherit", label: "Inherit config" },
  { id: "none", label: "No API key environment variable" },
  { id: "variable", label: "Environment variable" },
];

/** Settings has no inherited state: the row already holds a concrete value. */
export const SETTINGS_CREDENTIAL_OPTIONS = CREDENTIAL_OPTIONS.filter(
  (option) => option.id !== "inherit",
);
