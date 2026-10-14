import type { NacClient } from "./nacClient.js";
import type { PublicNacModelCatalog, PublicNacModelConfiguration, PublicNacProject, PublicNacSessionConfig, PublicNacSessionSummary, PublicNacUiConfiguration } from "./publicNative.generated.js";
/** Describes a wire family. It conveys no resource or operation authority. */
export interface PublicNacPresentationSource {
    contract: "public-native-v1";
    /** Caller supplies its maintained schema codecs, including exact price-number decoding. */
    decoders: PublicNacResponseDecoders;
}
export interface PublicNacResponseDecoders {
    uiConfiguration: (text: string) => PublicNacUiConfiguration;
    modelCatalog: (text: string) => PublicNacModelCatalog;
    modelConfigs: (text: string) => PublicNacModelConfiguration[];
    projects: (text: string) => PublicNacProject[];
    sessions: (text: string) => PublicNacSessionSummary[];
    sessionConfig: (text: string) => PublicNacSessionConfig;
}
export interface PublicNacSessionListOptions {
    projectId?: string;
    workspaceStats?: boolean;
}
/** Additive public reads over the caller's existing authenticated native transport. */
export declare function createPublicNacApi(client: Pick<NacClient, "transport">, source: PublicNacPresentationSource): Readonly<{
    getUiConfiguration: (signal?: AbortSignal) => Promise<PublicNacUiConfiguration>;
    getModelCatalog: (signal?: AbortSignal) => Promise<PublicNacModelCatalog>;
    listModelConfigs: (signal?: AbortSignal) => Promise<PublicNacModelConfiguration[]>;
    listProjects: (signal?: AbortSignal) => Promise<PublicNacProject[]>;
    listSessions: (options?: PublicNacSessionListOptions, signal?: AbortSignal) => Promise<PublicNacSessionSummary[]>;
    getSessionConfig: (sessionId: string, signal?: AbortSignal) => Promise<PublicNacSessionConfig>;
}>;
export type PublicNacApi = ReturnType<typeof createPublicNacApi>;
