export declare function useStoreInfo(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    root_cwd: string;
    store_path: string;
    worker_executable: string;
}>, Error>;
/**
 * Which API key names have a value stored in NAC home. Used to tell the user
 * whether a session can authenticate without the environment variable being
 * set; failures are non-fatal because the environment may well supply the key.
 */
export declare function useStoredCredentials(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    credentials: import("../../types/openapi.generated").components["schemas"]["StoredCredentialSummary"][];
}>, Error>;
export declare function useStoreCredential(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    name: string;
    value: string;
}, unknown>;
/**
 * Files a key away and reports the name it was given. Used where the key is the
 * thing the user supplies and the selector is an implementation detail.
 */
export declare function useStoreGeneratedCredential(): import("@tanstack/react-query").UseMutationResult<{
    name: string;
}, Error, string, unknown>;
export declare function useDeleteCredential(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
/**
 * Whether the providers that sign in through a browser are signed in. Reported
 * per provider rather than per configuration, because the credential is one
 * file in NAC home that every session using that backend shares.
 */
export declare function useManagedLogout(): import("@tanstack/react-query").UseMutationResult<{
    account: string | null;
    backend: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["BackendKind"];
    base_url: string | null;
    expires_at_ms: number | null;
    organization: string | null;
    path: string;
    provider: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ManagedAuthProvider"];
    signed_in: boolean;
}, Error, "arcee" | "codex", unknown>;
