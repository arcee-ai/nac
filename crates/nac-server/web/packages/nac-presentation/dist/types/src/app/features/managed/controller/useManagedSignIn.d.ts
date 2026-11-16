import type { BackendKind } from "../../../types/api";
/**
 * Whether the browser login a backend authenticates through is already in
 * place, and `null` for a backend that takes a key instead.
 *
 * The login belongs to the provider rather than to any one configuration — one
 * file in NAC home backs every session using that backend — so this reads the
 * same whichever session or setup is being edited.
 */
export declare function useManagedSignIn(backend: BackendKind): {
    provider: "arcee" | "codex" | null;
    signedIn: boolean;
};
