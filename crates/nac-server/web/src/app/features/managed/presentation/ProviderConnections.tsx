import { ManagedAuthCallout } from "./ManagedAuthCallout";

/** Provider accounts coexist independently of the model selected for a chat. */
export function ProviderConnections() {
  return (
    <section aria-label="Provider connections" className="flex flex-col gap-4">
      <p className="text-small !leading-[22px] text-basic-secondary">
        Connect another account without changing this chat or signing out of your current provider.
        API keys and custom endpoints are available in Advanced provider setup.
      </p>
      <ManagedAuthCallout backend="arcee-auth" />
      <ManagedAuthCallout backend="chatgpt-codex-responses" />
    </section>
  );
}
