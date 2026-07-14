// Backend + reasoning-effort choices mirror nac-core's serde enums
// (BackendKind = kebab-case, ReasoningEffort = lowercase).
export const BACKEND_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "chatgpt-codex-responses", label: "ChatGPT Codex Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "fireworks-chat", label: "Fireworks Chat" },
  { id: "together-chat", label: "Together Chat" },
];

export const REASONING_OPTIONS = [
  { id: "", label: "Default" },
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X-High" },
];
