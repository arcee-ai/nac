import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { managedAuthProvider } from "@/app/lib/providers";
import { humanError, type RunError } from "@/app/lib/providerError";
import { queryKeys, useManagedAuth, useManagedProviderModels } from "@/app/services/queries";

/**
 * Whether a run failure asking for a login should be kept off screen, because
 * the login it asked for is back in place — or because nothing has said yet
 * that it is not.
 *
 * A run failure has no expiry: nothing clears it before the next run, and a
 * reload replays the event that produced it, which is what leaves a "Sign in
 * again" box standing long after the login it asked for. Signing in is not an
 * event this can wait for either — it happens in the settings modal, in another
 * tab, or at the CLI just as often as through the box itself — so the question
 * is whether the credential works now, not whether a login was observed.
 *
 * Being signed in only says a credential is on file, so this asks what the
 * Authentication row asks: whether the request that spends it succeeds. Until
 * that answer arrives the box stays down, since showing it first and retracting
 * it a moment later tells a signed-in user to sign in again. A failure that a
 * login has no bearing on is reported as it is, with nothing fetched for it.
 */
export function useAuthErrorSuppressed(backend: string | null, error: RunError): boolean {
  const asksForLogin = error != null && humanError(error, backend).fix?.kind === "login";
  const provider = backend ? managedAuthProvider(backend) : null;
  const auth = useManagedAuth(asksForLogin && provider !== null);
  const entry = auth.data?.providers.find((status) => status.provider === provider);
  const probeBackend = entry?.backend ?? null;
  const signedIn = Boolean(entry?.signed_in);
  const reach = useManagedProviderModels(probeBackend, asksForLogin && signedIn);

  const client = useQueryClient();
  useEffect(() => {
    if (!asksForLogin || probeBackend === null) return;
    // The run spent this credential and had it refused, so a success cached for
    // it beforehand is no longer evidence of anything — without this, a model
    // index read minutes earlier would answer for a login that has since died.
    void client.invalidateQueries({
      queryKey: queryKeys.managedProviderModels(probeBackend),
    });
  }, [asksForLogin, probeBackend, client]);

  // Anything that leaves the credential unusable, or leaves this unable to tell:
  // a backend that signs in some other way and cannot be probed at all, an
  // authentication list that would not load, no credential on file, or a probe
  // the credential was refused for.
  const confirmed =
    provider === null || auth.isError || (auth.data != null && !signedIn) || reach.isError;

  return asksForLogin && !confirmed;
}
