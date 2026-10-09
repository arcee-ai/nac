import { type RunError } from "../lib/providerError";
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
export declare function useAuthErrorSuppressed(backend: string | null, error: RunError): boolean;
