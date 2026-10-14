/** Public wire projections share the native runtime's cache and cancellation lifetime. */
export declare const publicNativeKeys: {
    uiConfiguration: readonly ["public-native-v1", "ui-configuration"];
    catalog: readonly ["public-native-v1", "model-catalog"];
    modelConfigs: readonly ["public-native-v1", "model-configs"];
    sessionConfig: (id: string) => readonly ["public-native-v1", "session", string, "config"];
};
export declare function usePublicModelCatalog(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/index.js").PublicNacModelCatalog>, Error>;
export declare function usePublicModelConfigs(): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/index.js").PublicNacModelConfiguration[]>, Error>;
export declare function usePublicSessionConfig(id: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<import("../../../../packages/nac-client/src/index.js").PublicNacSessionConfig>, Error>;
