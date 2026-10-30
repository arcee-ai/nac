import type { BackendKind } from "../../../types/api";
/**
 * What the server's account list says about one provider's login: still being
 * asked, answered either way, or unanswerable because the check itself failed.
 * Only `signed-out` is a reason to offer a fresh sign-in.
 */
export type ManagedSignInStatus = "checking" | "signed-in" | "signed-out" | "unavailable";
/**
 * Whether the browser login a backend authenticates through is already in
 * place, with `provider` null for a backend that takes a key instead.
 *
 * The login belongs to the provider rather than to any one configuration — one
 * file in NAC home backs every session using that backend — so this reads the
 * same whichever session or setup is being edited. An answer already on hand
 * outlives a failed refresh: a dropped request says nothing about the
 * credential, so it never turns a known login into a signed-out one.
 */
export declare function useManagedSignIn(backend: BackendKind): {
    provider: "arcee" | "codex" | null;
    status: ManagedSignInStatus;
    signedIn: boolean;
    error: Error | null;
    retry: () => undefined;
};
