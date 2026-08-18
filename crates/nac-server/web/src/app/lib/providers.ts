// "Provider" is the user-facing name for nac-core's BackendKind: the wire
// protocol a session speaks. The Rust enum is authoritative, so every variant of
// `types/api.ts#BackendKind` must appear here.

import type { BackendKind, ManagedAuthProvider } from "@/app/types/api";

const PROVIDER_LABELS = {
  "openai-responses": "OpenAI Responses",
  "chatgpt-codex-responses": "ChatGPT Codex Responses",
  "anthropic-messages": "Anthropic Messages",
  "deepseek-chat": "DeepSeek Chat",
  "fireworks-chat": "Fireworks Chat",
  "together-chat": "Together Chat",
  "arcee-auth": "Arcee API (Sign in)",
  "arcee-api": "Arcee API (Key)",
  "xai-auth": "xAI SuperGrok",
} satisfies Record<BackendKind, string>;

/** Display order shared by every provider list in the UI. */
export const PROVIDER_KINDS: BackendKind[] = [
  "arcee-api",
  "arcee-auth",
  "openai-responses",
  "chatgpt-codex-responses",
  "anthropic-messages",
  "deepseek-chat",
  "fireworks-chat",
  "together-chat",
  "xai-auth",
];

/** Stable rank for sorting provider lists; unknown backends sink to the end. */
export function providerOrder(backend: string): number {
  // SAFETY: indexOf only compares the value against the known kinds; a backend
  // outside the enum yields -1, which the length fallback below handles.
  const index = PROVIDER_KINDS.indexOf(backend as BackendKind);
  return index === -1 ? PROVIDER_KINDS.length : index;
}

/**
 * Providers authenticated with a user-supplied key rather than a stored login.
 * Mirrors `api_key_backend` in `crates/nac-core/src/model/backend.rs`; the ones
 * left out sign requests with credentials the server already holds, so the
 * launch modal neither asks for a key nor can list their models.
 */
const API_KEY_PROVIDERS: ReadonlySet<BackendKind> = new Set<BackendKind>([
  "openai-responses",
  "anthropic-messages",
  "deepseek-chat",
  "fireworks-chat",
  "together-chat",
  "arcee-api",
]);

export function providerUsesApiKey(backend: BackendKind): boolean {
  return API_KEY_PROVIDERS.has(backend);
}

/**
 * The browser login a backend authenticates through. Mirrors
 * `ManagedAuthProvider::for_backend` in `crates/nac-core/src/model/mod.rs`.
 */
interface ManagedAuthProviderByBackend {
  [backend: string]: ManagedAuthProvider | undefined;
}

const MANAGED_AUTH_PROVIDERS = {
  "arcee-auth": "arcee",
  "chatgpt-codex-responses": "codex",
  "xai-auth": "xai",
} satisfies Partial<Record<BackendKind, ManagedAuthProvider>>;

export function managedAuthProvider(backend: string): ManagedAuthProvider | null {
  // SAFETY: the satisfies above constrains the map's keys to BackendKind, so
  // the string-indexed read yields ManagedAuthProvider or undefined.
  const providers = MANAGED_AUTH_PROVIDERS as ManagedAuthProviderByBackend;
  return providers[backend] ?? null;
}

/**
 * The account a browser login signs into, named the way the provider's own
 * sign-in page names it rather than after the backend it unlocks.
 */
const MANAGED_AUTH_LABELS = {
  arcee: "Arcee",
  codex: "ChatGPT",
  xai: "SuperGrok",
} satisfies Record<ManagedAuthProvider, string>;

export function managedAuthLabel(provider: ManagedAuthProvider): string {
  return MANAGED_AUTH_LABELS[provider];
}

function isBackendKind(backend: string): backend is BackendKind {
  return backend in PROVIDER_LABELS;
}

/**
 * Legacy rows persist an empty backend, and a row written by a newer build can
 * carry a kind this bundle does not know yet; both fall back to the raw value.
 */
export function providerLabel(backend: string | null | undefined): string {
  const kind = (backend ?? "").trim();
  if (!kind) return "";
  return isBackendKind(kind) ? PROVIDER_LABELS[kind] : kind;
}

/** Providers present in the given sessions, in canonical display order. */
export function providersFromBackends(backends: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const backend of backends) {
    const kind = (backend ?? "").trim();
    if (kind) seen.add(kind);
  }
  const known = PROVIDER_KINDS.filter((kind) => seen.has(kind));
  const unknown = Array.from(seen)
    .filter((kind) => !isBackendKind(kind))
    .sort();
  return [...known, ...unknown];
}
