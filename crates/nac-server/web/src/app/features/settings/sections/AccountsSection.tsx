import { useState } from "react";

import { Button, ButtonVariant, IconName, Input } from "@/app/atoms";
import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import { routes } from "@/app/lib/routes";
import { providerLabel } from "@/app/lib/providers";
import { useModelCatalog } from "@/app/services/queries";
import type { ModelCatalog } from "@/app/types/api";

import { SettingsGroup, SettingsLinkRow, SettingsRow } from "../SettingsRows";

type ProviderListing = ModelCatalog["providers"][number];

/** Who the key belongs to, not which wire protocol uses it. */
const VENDORS: Partial<Record<string, string>> = {
  "anthropic-messages": "Anthropic",
  "openai-responses": "OpenAI",
  "openai-chat-completions": "OpenAI",
  "deepseek-chat": "DeepSeek",
  "fireworks-chat": "Fireworks",
  "together-chat": "Together AI",
  "arcee-api": "Arcee",
};

interface ProviderKey {
  label: string;
  envVar: string | null;
  ready: boolean;
}

/** Backends that read the same key collapse into one row. */
function providerKeys(providers: readonly ProviderListing[]): ProviderKey[] {
  const keys = new Map<string, ProviderKey>();
  for (const provider of providers) {
    if (provider.auth !== "api_key_env") continue;
    const label = VENDORS[provider.id] ?? providerLabel(provider.id);
    const envVar = provider.auth_hint || null;
    const id = envVar ?? label;
    const existing = keys.get(id);
    const ready = provider.auth_status === "ready";
    if (existing) existing.ready ||= ready;
    else keys.set(id, { label, envVar, ready });
  }
  return [...keys.values()].sort((a, b) => Number(b.ready) - Number(a.ready));
}

/**
 * Settings › Accounts & keys: subscription sign-ins and one API key per
 * provider, kept apart from any project or chat so setting up a project never
 * asks for them.
 */
export function AccountsSection() {
  const catalog = useModelCatalog();
  const keyed = providerKeys(catalog.data?.providers ?? []);
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Subscriptions"
        description="Sign in once with an account you already pay for. Every session on that provider uses it."
      >
        <div>
          <ManagedAuthCallout backend="chatgpt-codex-responses" className="rounded-none border-0" />
        </div>
        <div>
          <ManagedAuthCallout backend="arcee-auth" className="rounded-none border-0" />
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="API keys"
        description="One key per provider, stored on the NAC server and never shown again after you save it."
      >
        {catalog.isPending ? (
          <SettingsRow label="Loading providers…" />
        ) : keyed.length === 0 ? (
          <SettingsRow label="No providers use API keys on this server." />
        ) : (
          keyed.map((provider) => (
            <ProviderKeyRow key={provider.envVar ?? provider.label} provider={provider} />
          ))
        )}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsLinkRow
          label="Models & providers"
          hint="Saved model setups, custom endpoints and per-setup keys"
          to={routes.settings("models")}
          icon={IconName.Ai}
        />
      </SettingsGroup>
    </div>
  );
}

function ProviderKeyRow({ provider }: { provider: ProviderKey }) {
  const { label, envVar } = provider;
  const fromEnvironment = provider.ready;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // TODO(backend): store one key per provider in the credential store (exact-value
  // redacted, never returned) and report it through `auth_status`. Today a key
  // lives only on a saved model setup or in the server's environment, so this
  // saved state lasts until the page reloads.
  const [savedSuffix, setSavedSuffix] = useState<string | null>(null);

  const save = () => {
    const key = draft.trim();
    if (!key) return;
    setSavedSuffix(key.slice(-4));
    setDraft("");
    setEditing(false);
  };

  if (editing) {
    return (
      <SettingsRow
        label={label}
        stacked
        control={
          <form
            className="flex min-w-0 flex-1 items-center gap-2 max-sm:flex-wrap"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Input
              type="password"
              autoFocus
              autoComplete="off"
              aria-label={`${label} API key`}
              placeholder={`Paste your ${label} key`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1"
            />
            <Button
              variant={ButtonVariant.Ghost}
              onClick={() => {
                setDraft("");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant={ButtonVariant.Primary} disabled={!draft.trim()}>
              Save key
            </Button>
          </form>
        }
      />
    );
  }

  const hint = savedSuffix
    ? `Key ending in ${savedSuffix}`
    : fromEnvironment
      ? envVar
        ? `Using ${envVar} from the server environment`
        : "Connected on the server"
      : "Not connected";
  return (
    <SettingsRow
      label={label}
      hint={hint}
      control={
        savedSuffix ? (
          <>
            <Button variant={ButtonVariant.Ghost} onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button variant={ButtonVariant.Ghost} onClick={() => setSavedSuffix(null)}>
              Remove
            </Button>
          </>
        ) : (
          <Button
            variant={fromEnvironment ? ButtonVariant.Ghost : ButtonVariant.Secondary}
            onClick={() => setEditing(true)}
          >
            {fromEnvironment ? "Use a different key" : "Add key"}
          </Button>
        )
      }
    />
  );
}
