// Backend + reasoning-effort choices mirror nac-core's serde enums
// (BackendKind = kebab-case, ReasoningEffort = lowercase) and the old UI's
// launch/settings selects.
export const BACKEND_OPTIONS = [
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

// Launch offers "inherit" (empty) + "clear configured effort"; Settings reuses
// the same list where "inherit" is unavailable (see SETTINGS_REASONING_OPTIONS).
export const REASONING_OPTIONS = [
  { id: "", label: "Inherit config" },
  { id: "__clear__", label: "Clear configured effort" },
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X-High" },
];

export const CREDENTIAL_OPTIONS = [
  { id: "inherit", label: "Inherit config" },
  { id: "none", label: "No API key environment variable" },
  { id: "variable", label: "Environment variable" },
];
