// Model/credential launch logic ported from the old app.js so the React launch
// modal keeps parity with managed backends (Arcee/Codex), credential modes,
// reasoning-effort clearing, and extra-headers validation.

export const MANAGED_LAUNCH_BASE_URLS = Object.freeze({
  "arcee-auth": "https://api.arcee.ai/api/v1",
  "chatgpt-codex-responses": "https://chatgpt.com/backend-api",
});

export function managedLaunchBaseUrl(backend) {
  return MANAGED_LAUNCH_BASE_URLS[String(backend || "").trim()] || null;
}

export function isManagedBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? "").trim();
  return Object.values(MANAGED_LAUNCH_BASE_URLS).includes(normalized);
}

export function effectiveBackend(selectedBackend, configuredBackend) {
  return String(selectedBackend || "").trim() || String(configuredBackend || "").trim();
}

// Backends that authenticate from stored credentials (no api_key_env allowed).
export function backendUsesStoredCredentials(backend) {
  return backend === "arcee-auth" || backend === "chatgpt-codex-responses";
}

export function nullable(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function optionalLaunchString(value, label) {
  const raw = String(value ?? "");
  if (raw === "") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${label} cannot contain only whitespace`);
  return trimmed;
}

function selectedApiKeyEnv(mode, value) {
  if (mode === "inherit") return undefined;
  if (mode === "none") return null;
  if (mode !== "variable") throw new Error("Choose how credentials are selected");
  const selected = String(value ?? "");
  if (!selected) throw new Error("API key environment variable is required when Environment variable is selected");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(selected)) {
    throw new Error("API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)");
  }
  return selected;
}

function validateCredentialMode(backend, mode) {
  if (!backend) return;
  const stored = backendUsesStoredCredentials(backend);
  if (stored && mode !== "none") {
    const source = backend === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth";
    throw new Error(`${backend} uses ${source} and does not accept an API key environment variable`);
  }
  if (!stored && mode !== "variable") {
    throw new Error(`${backend} requires an API key environment variable; explicitly select Environment variable`);
  }
}

export function serializeExtraHeaders(value, blankValue) {
  const raw = String(value ?? "").trim();
  if (!raw) return blankValue;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Extra Headers must be valid JSON");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Extra Headers must be a JSON object with string keys and string values");
  }
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Extra Headers value for "${key}" must be a string`);
    }
  }
  return parsed;
}

function requiredSettingsString(value, label) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error(`${label} is required and cannot be cleared`);
  return trimmed;
}

function sameHeaderObject(left, right) {
  const l = Object.keys(left).sort();
  const r = Object.keys(right).sort();
  return l.length === r.length && l.every((k, i) => k === r[i] && left[k] === right[k]);
}

// Build a minimal config patch from the Settings form, validating required
// fields and credential rules. Ported from app.js buildSettingsPatch.
export function buildSettingsPatch(values, initial) {
  const backend = requiredSettingsString(values.backend, "Backend");
  const managedUrl = managedLaunchBaseUrl(backend);
  let baseUrl;
  let apiKeyEnv;
  if (managedUrl) {
    baseUrl = managedUrl;
    apiKeyEnv = null;
  } else {
    baseUrl = requiredSettingsString(values.base_url, "Base URL");
    apiKeyEnv = selectedApiKeyEnv(values.credential_mode, values.api_key_env);
    if (apiKeyEnv === undefined) {
      throw new Error("Select an API key environment variable or explicitly choose none");
    }
    validateCredentialMode(backend, values.credential_mode);
  }

  const current = {
    model: requiredSettingsString(values.model, "Model"),
    base_url: baseUrl,
    backend,
    reasoning_effort: values.reasoning_effort === "__clear__" ? null : values.reasoning_effort || null,
    api_key_env: apiKeyEnv,
    extra_headers: serializeExtraHeaders(values.extra_headers, {}),
  };

  const patch = {};
  for (const field of ["model", "base_url", "backend", "reasoning_effort", "api_key_env"]) {
    if (current[field] !== initial[field]) patch[field] = current[field];
  }
  if (initial.extra_headers_invalid || !sameHeaderObject(current.extra_headers, initial.extra_headers || {})) {
    patch.extra_headers = current.extra_headers;
  }
  return patch;
}

export function launchLocationFromValues(values) {
  const sshHost = nullable(values?.ssh_host);
  return {
    cwd: sshHost ? nullable(values?.cwd) || "~" : nullable(values?.cwd),
    ssh_host: sshHost,
  };
}

// Build the model/credential portion of a create-session payload, mirroring the
// old buildLaunchModelPayload. `configured_backend` comes from launch-defaults.
export function buildLaunchModelPayload(values) {
  const payload = {};
  const model = optionalLaunchString(values.model, "Model");
  if (model !== undefined) payload.model = model;

  const selectedBackend = optionalLaunchString(values.backend, "Backend");
  if (selectedBackend !== undefined) payload.backend = selectedBackend;
  const backend = effectiveBackend(selectedBackend, values.configured_backend);
  const managedUrl = managedLaunchBaseUrl(backend);

  if (managedUrl) {
    if (selectedBackend !== undefined) payload.base_url = managedUrl;
  } else {
    const baseUrl = optionalLaunchString(values.base_url, "Base URL");
    if (baseUrl !== undefined) payload.base_url = baseUrl;
  }

  const effort = String(values.reasoning_effort ?? "");
  if (effort === "__clear__") payload.reasoning_effort = null;
  else if (effort) payload.reasoning_effort = effort;

  if (managedUrl) {
    payload.api_key_env = null;
  } else {
    const credentialMode = String(values.credential_mode || "inherit");
    validateCredentialMode(payload.backend, credentialMode);
    const apiKeyEnv = selectedApiKeyEnv(credentialMode, values.api_key_env);
    if (apiKeyEnv !== undefined) payload.api_key_env = apiKeyEnv;
  }

  const headers = serializeExtraHeaders(values.extra_headers, undefined);
  if (headers !== undefined) payload.extra_headers = headers;
  return payload;
}
