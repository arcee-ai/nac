import { managedAuthProvider } from "@/app/lib/providers";
import { useManagedAuth, useProviderReachAfterRefusal } from "@/app/features/managed/queries";

export type LoginUsability = "unusable" | "unknown" | "usable";

/** How often the authentication list is re-read while a refused login waits. */
const REFUSAL_POLL_MS = 10_000;

/** Whether the login a refused run needed works now, wherever the sign-in happened. */
export function useLoginUsability(backend: string | null, refusal: string | null): LoginUsability {
  const provider = backend ? managedAuthProvider(backend) : null;
  const watching = refusal !== null && provider !== null;
  const auth = useManagedAuth(watching, watching ? REFUSAL_POLL_MS : false);
  const entry = auth.data?.providers.find((status) => status.provider === provider);
  const credential = entry?.signed_in
    ? `${entry.expires_at_ms ?? ""}:${entry.account ?? ""}`
    : null;
  const probe = useProviderReachAfterRefusal(
    entry?.backend ?? null,
    watching ? refusal : null,
    credential,
  );

  if (!watching || auth.isError || (auth.data != null && credential === null) || probe.isError)
    return "unusable";
  return probe.isSuccess ? "usable" : "unknown";
}
