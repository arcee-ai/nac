import { useRef, useState } from "react";

import { Button, ButtonVariant, Input } from "@/app/atoms";
import { ManagedAuthCallout } from "@/app/features/managed/presentation/ManagedAuthCallout";
import { providerLabel } from "@/app/lib/providers";
import {
  useDeleteCredential,
  useModelCatalog,
  useStoreCredential,
  useStoredCredentials,
} from "@/app/services/queries";
import type { ModelCatalog, StoredCredentialList } from "@/app/types/api";

import { SettingsGroup, SettingsRow } from "../SettingsRows";

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
  name: string | null;
  ready: boolean;
  stored?: StoredCredentialList["credentials"][number];
}

/** The two OpenAI API transports share one account. */
function providerKeys(
  providers: readonly ProviderListing[],
  credentials: StoredCredentialList["credentials"],
): ProviderKey[] {
  const keys = new Map<string, ProviderKey>();
  for (const provider of providers) {
    if (provider.auth !== "api_key_env") continue;
    const label = VENDORS[provider.id] ?? providerLabel(provider.id);
    const name = provider.connection?.api_key_env ?? provider.auth_hint ?? null;
    const stored = credentials.find((credential) => credential.name === name);
    const ready = provider.auth_status === "ready";
    const existing = keys.get(label);
    if (!existing || (!existing.ready && ready) || (!existing.stored && stored)) {
      keys.set(label, { label, name, ready, stored });
    }
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
  const credentials = useStoredCredentials();
  const keyed = providerKeys(catalog.data?.providers ?? [], credentials.data?.credentials ?? []);
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Subscriptions"
        description="Sign in once with an account you already pay for. Every session on that provider uses it."
      >
        <div role="group" aria-label="ChatGPT account">
          <ManagedAuthCallout backend="chatgpt-codex-responses" className="rounded-none border-0" />
        </div>
        <div role="group" aria-label="Arcee account">
          <ManagedAuthCallout backend="arcee-auth" className="rounded-none border-0" />
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="API keys"
        description="One key per provider, stored on the NAC server and never shown again after you save it."
      >
        {catalog.isPending || credentials.isPending ? (
          <SettingsRow label="Loading providers…" />
        ) : catalog.isError || credentials.isError ? (
          <SettingsRow
            label={<span role="alert">Could not load provider keys.</span>}
            control={
              <Button
                variant={ButtonVariant.Secondary}
                onClick={() => {
                  void catalog.refetch();
                  void credentials.refetch();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : keyed.length === 0 ? (
          <SettingsRow label="No providers use API keys on this server." />
        ) : (
          keyed.map((provider) => <ProviderKeyRow key={provider.label} provider={provider} />)
        )}
      </SettingsGroup>
    </div>
  );
}

function ProviderKeyRow({ provider }: { provider: ProviderKey }) {
  const { label, name, ready, stored } = provider;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saving = useStoreCredential();
  const removing = useDeleteCredential();
  const busy = saving.isPending || removing.isPending;
  const pending = useRef(false);
  const errorNotice = error ? (
    <span role="alert" className="text-error-primary">
      {error}
    </span>
  ) : null;

  const save = async () => {
    const key = draft.trim();
    if (!name || !key || pending.current) return;
    pending.current = true;
    setError(null);
    try {
      await saving.mutateAsync({ name, value: key });
      setDraft("");
      setEditing(false);
    } catch {
      setError("Could not save the key. Try again.");
    } finally {
      pending.current = false;
      saving.reset();
    }
  };

  const remove = async () => {
    if (!stored || pending.current) return;
    pending.current = true;
    setError(null);
    try {
      await removing.mutateAsync(stored.name);
    } catch {
      setError("Could not remove the key. Try again.");
    } finally {
      pending.current = false;
    }
  };

  const edit = () => {
    setError(null);
    setEditing(true);
  };

  if (editing) {
    return (
      <SettingsRow
        label={label}
        hint={errorNotice}
        stacked
        control={
          <form
            className="flex min-w-0 flex-1 items-center gap-2 max-sm:flex-wrap"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              type="password"
              autoFocus
              autoComplete="off"
              aria-label={`${label} API key`}
              placeholder={`Paste your ${label} key`}
              disabled={busy}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1"
            />
            <Button
              variant={ButtonVariant.Ghost}
              disabled={busy}
              onClick={() => {
                setDraft("");
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={ButtonVariant.Primary}
              loading={busy}
              disabled={!draft.trim()}
            >
              Save key
            </Button>
          </form>
        }
      />
    );
  }

  const hint = stored
    ? ready
      ? stored.last_four
        ? `Key ending in ${stored.last_four}`
        : "Key stored on the server"
      : "Key stored but unavailable to the provider"
    : ready
      ? "Connected on the server"
      : "Not connected";
  return (
    <SettingsRow
      label={label}
      hint={errorNotice ?? hint}
      control={
        stored ? (
          <>
            <Button
              variant={ButtonVariant.Ghost}
              disabled={busy}
              aria-label={`Replace ${label} key`}
              onClick={edit}
            >
              Replace
            </Button>
            <Button
              variant={ButtonVariant.Ghost}
              loading={busy}
              aria-label={`Remove ${label} key`}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </>
        ) : !ready && name ? (
          <Button variant={ButtonVariant.Secondary} aria-label={`Add ${label} key`} onClick={edit}>
            Add key
          </Button>
        ) : null
      }
    />
  );
}
