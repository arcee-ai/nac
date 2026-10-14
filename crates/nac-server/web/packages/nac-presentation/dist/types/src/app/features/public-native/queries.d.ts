import type { PublicNacSessionListOptions } from "../../../../packages/nac-client/src/publicNacApi.js";
/** Public wire projections share the native runtime's cache and cancellation lifetime. */
export declare const publicNativeKeys: {
    uiConfiguration: readonly ["public-native-v1", "ui-configuration"];
    catalog: readonly ["public-native-v1", "model-catalog"];
    modelConfigs: readonly ["public-native-v1", "model-configs"];
    projects: readonly ["public-native-v1", "projects"];
    sessions: (options: PublicNacSessionListOptions) => readonly ["public-native-v1", "sessions", PublicNacSessionListOptions];
    sessionConfig: (id: string) => readonly ["public-native-v1", "session", string, "config"];
};
export declare function usePublicModelCatalog(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/publicNative.generated.js").PublicNacModelCatalog>, Error>;
export declare function usePublicModelConfigs(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/publicNative.generated.js").PublicNacModelConfiguration[]>, Error>;
export declare function usePublicProjects(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/publicNative.generated.js").PublicNacProject[]>, Error>;
export declare function usePublicSessions(options?: PublicNacSessionListOptions): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/publicNative.generated.js").PublicNacSessionSummary[]>, Error>;
export declare function usePublicSessionConfig(id: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/publicNative.generated.js").PublicNacSessionConfig>, Error>;
