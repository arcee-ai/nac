import type { NacClient, NacRequestOptions } from "./nacClient.js";
import type { PublicNacProject } from "./publicNative.generated.js";
import type { PublicNacCreatedSession, PublicNacCreateProject, PublicNacCreateSession, PublicNacRuntimeMetadata, PublicNacWorkingLocation } from "./publicNativeCreation.generated.js";
/** Data codecs only. The receiving owner still supplies genuine operation/resource authority. */
export interface PublicNacCreationSource {
    contract: "public-native-v1";
    decoders: {
        workingLocations: (text: string) => PublicNacWorkingLocation[];
        runtimeMetadata: (text: string) => PublicNacRuntimeMetadata;
        project: (text: string) => PublicNacProject;
        createdSession: (text: string) => PublicNacCreatedSession;
    };
    /** Maintained canonical validators reject unknown/private fields before dispatch. */
    requests: {
        project: (value: unknown) => PublicNacCreateProject;
        session: (value: unknown) => PublicNacCreateSession;
    };
}
export type PublicNacCreationRequestOptions = Pick<NacRequestOptions, "signal" | "requestId">;
/**
 * Explicit source ports for the frozen creation/metadata operations. This is not
 * installed into the presentation runtime or its closed collection commands.
 * Command results describe delivery fate, never backend admission or permission.
 */
export declare function createPublicNacCreationApi(client: Pick<NacClient, "transport">, source: PublicNacCreationSource): Readonly<{
    listWorkingLocations: (signal?: AbortSignal) => Promise<PublicNacWorkingLocation[]>;
    getRuntimeMetadata: (signal?: AbortSignal) => Promise<PublicNacRuntimeMetadata>;
    createProject: (payload: PublicNacCreateProject, options?: PublicNacCreationRequestOptions) => Promise<import("./nacClient.js").CommandAdmission<PublicNacProject>>;
    createSession: (payload: PublicNacCreateSession, options?: PublicNacCreationRequestOptions) => Promise<import("./nacClient.js").CommandAdmission<PublicNacCreatedSession>>;
}>;
export type PublicNacCreationApi = ReturnType<typeof createPublicNacCreationApi>;
