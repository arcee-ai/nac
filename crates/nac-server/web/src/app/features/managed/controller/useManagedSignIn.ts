import { managedAuthProvider } from "@/app/lib/providers";
import { useManagedAuth } from "@/app/features/managed/queries";
import type { BackendKind } from "@/app/types/api";

/**
 * Whether the browser login a backend authenticates through is already in
 * place, and `null` for a backend that takes a key instead.
 *
 * The login belongs to the provider rather than to any one configuration — one
 * file in NAC home backs every session using that backend — so this reads the
 * same whichever session or setup is being edited.
 */
export function useManagedSignIn(backend: BackendKind) {
  const provider = managedAuthProvider(backend);
  const { data } = useManagedAuth(Boolean(provider));
  const signedIn = Boolean(
    provider && data?.providers.find((entry) => entry.provider === provider)?.signed_in,
  );
  return { provider, signedIn };
}
