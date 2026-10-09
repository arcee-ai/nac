import type { BackendKind, ManagedAuthProvider } from "../types/api";
/** Display order shared by every provider list in the UI. */
export declare const PROVIDER_KINDS: BackendKind[];
/** Stable rank for sorting provider lists; unknown backends sink to the end. */
export declare function providerOrder(backend: string): number;
export declare function providerUsesApiKey(backend: BackendKind): boolean;
export declare function managedAuthProvider(backend: string): ManagedAuthProvider | null;
export declare function managedAuthLabel(provider: ManagedAuthProvider): string;
/**
 * Legacy rows persist an empty backend, and a row written by a newer build can
 * carry a kind this bundle does not know yet; both fall back to the raw value.
 */
export declare function providerLabel(backend: string | null | undefined): string;
/** Providers present in the given sessions, in canonical display order. */
export declare function providersFromBackends(backends: Iterable<string>): string[];
