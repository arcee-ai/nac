export declare function useProductContext(sessionId: string | null, enabled: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    build: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ProductBuild"];
    destinations: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ProductDestinationInfo"][];
    features: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ProductFeature"][];
    managed: boolean;
    mcp: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ProductCapability"];
    schema_version: number;
    session: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ProductSessionContext"] | null;
    source: string;
}>, Error>;
