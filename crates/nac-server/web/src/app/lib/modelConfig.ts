// Model and credential rules shared by the launch and settings modals: managed
// backends with a fixed base URL, credential modes, reasoning-effort clearing
// and extra-header validation. Ported from the legacy UI unchanged.

import type { UpdateConfigRequest } from "@/app/types/api";

export const MANAGED_LAUNCH_BASE_URLS: Record<string, string> = {
  "arcee-auth": "https://api.arcee.ai/api/v1",
  "chatgpt-codex-responses": "https://chatgpt.com/backend-api",
};

export type CredentialMode = "inherit" | "none" | "variable";

/** Reasoning effort sentinel meaning "clear the configured value". */
export const CLEAR_EFFORT = "__clear__";

export function managedLaunchBaseUrl(backend: string | null | undefined): string | null {
  return MANAGED_LAUNCH_BASE_URLS[(backend ?? "").trim()] ?? null;
}

/** Backends that authenticate from stored credentials (no api_key_env allowed). */
export function backendUsesStoredCredentials(backend: string): boolean {
  return backend === "arcee-auth" || backend === "chatgpt-codex-responses";
}

export function nullable(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function csv(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** `undefined` inherits the configured value, `null` clears it. */
function selectedApiKeyEnv(
  mode: CredentialMode,
  value: string,
): string | null | undefined {
  if (mode === "inherit") return undefined;
  if (mode === "none") return null;
  if (mode !== "variable") throw new Error("Choose how credentials are selected");
  if (!value) {
    throw new Error(
      "API key environment variable is required when Environment variable is selected",
    );
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      "API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)",
    );
  }
  return value;
}

function validateCredentialMode(
  backend: string | undefined,
  mode: CredentialMode,
): void {
  if (!backend) return;
  const stored = backendUsesStoredCredentials(backend);
  if (stored && mode !== "none") {
    const source =
      backend === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth";
    throw new Error(
      `${backend} uses ${source} and does not accept an API key environment variable`,
    );
  }
  if (!stored && mode !== "variable") {
    throw new Error(
      `${backend} requires an API key environment variable; explicitly select Environment variable`,
    );
  }
}

export function serializeExtraHeaders<T>(
  value: string,
  blankValue: T,
): Record<string, string> | T {
  const raw = value.trim();
  if (!raw) return blankValue;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Extra Headers must be valid JSON");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(
      "Extra Headers must be a JSON object with string keys and string values",
    );
  }
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Extra Headers value for "${key}" must be a string`);
    }
  }
  return parsed as Record<string, string>;
}

function requiredSettingsString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required and cannot be cleared`);
  return trimmed;
}

function sameHeaderObject(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const l = Object.keys(left).sort();
  const r = Object.keys(right).sort();
  return l.length === r.length && l.every((key, i) => key === r[i] && left[key] === right[key]);
}

export interface LaunchLocation {
  cwd: string | null;
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_identity_file: string | null;
}

/**
 * A remote session without an explicit path lands in the remote home.
 *
 * The port and the key are only sent along with a host, and only when filled in:
 * left blank, they stay with ssh to decide, which is what a host configured in
 * `~/.ssh/config` wants.
 */
export function launchLocationFromValues(values: {
  cwd: string;
  ssh_host: string;
  ssh_port?: string;
  ssh_identity_file?: string;
}): LaunchLocation {
  const sshHost = nullable(values.ssh_host);
  const port = sshHost ? nullable(values.ssh_port ?? "") : null;
  return {
    cwd: sshHost ? (nullable(values.cwd) ?? "~") : nullable(values.cwd),
    ssh_host: sshHost,
    ssh_port: port === null ? null : Number(port),
    ssh_identity_file: sshHost
      ? nullable(values.ssh_identity_file ?? "")
      : null,
  };
}

export interface ModelFormValues {
  model: string;
  base_url: string;
  backend: string;
  reasoning_effort: string;
  credential_mode: CredentialMode;
  api_key_env: string;
  extra_headers: string;
}

export interface SettingsInitialValues {
  model: string;
  base_url: string;
  backend: string;
  reasoning_effort: string | null;
  api_key_env: string | null;
  extra_headers: Record<string, string>;
  /** Forces an extra-headers patch even when the parsed maps look equal. */
  extra_headers_invalid?: boolean;
}

/**
 * Minimal config patch from the settings form: required fields are validated,
 * unchanged fields are left out so a save never rewrites untouched values.
 */
export function buildSettingsPatch(
  values: ModelFormValues,
  initial: SettingsInitialValues,
): UpdateConfigRequest {
  const backend = requiredSettingsString(values.backend, "Backend");
  const managedUrl = managedLaunchBaseUrl(backend);

  let baseUrl: string;
  let apiKeyEnv: string | null;
  if (managedUrl) {
    baseUrl = managedUrl;
    apiKeyEnv = null;
  } else {
    baseUrl = requiredSettingsString(values.base_url, "Base URL");
    const selected = selectedApiKeyEnv(values.credential_mode, values.api_key_env);
    if (selected === undefined) {
      throw new Error("Select an API key environment variable or explicitly choose none");
    }
    apiKeyEnv = selected;
    validateCredentialMode(backend, values.credential_mode);
  }

  const current = {
    model: requiredSettingsString(values.model, "Model"),
    base_url: baseUrl,
    backend,
    reasoning_effort:
      values.reasoning_effort === CLEAR_EFFORT
        ? null
        : values.reasoning_effort || null,
    api_key_env: apiKeyEnv,
  };

  const patch: UpdateConfigRequest = {};
  for (const field of ["model", "base_url", "backend", "reasoning_effort", "api_key_env"] as const) {
    if (current[field] !== initial[field]) patch[field] = current[field];
  }

  const headers = serializeExtraHeaders(values.extra_headers, {});
  if (
    initial.extra_headers_invalid ||
    !sameHeaderObject(headers, initial.extra_headers)
  ) {
    patch.extra_headers = headers;
  }
  return patch;
}
