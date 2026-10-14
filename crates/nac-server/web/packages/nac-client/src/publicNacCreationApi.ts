import type { NacClient, NacRequestOptions } from "./nacClient.js";
import type { PublicNacProject } from "./publicNative.generated.js";
import type {
  PublicNacCreatedSession,
  PublicNacCreateProject,
  PublicNacCreateSession,
  PublicNacRuntimeMetadata,
  PublicNacWorkingLocation,
} from "./publicNativeCreation.generated.js";

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
export function createPublicNacCreationApi(
  client: Pick<NacClient, "transport">,
  source: PublicNacCreationSource,
) {
  if (
    source.contract !== "public-native-v1" ||
    client.transport.jsonResponseDecodingVersion !== 1 ||
    typeof client.transport.admit !== "function"
  ) {
    throw new Error(
      "Public native creation requires its explicit wire codecs and transport support.",
    );
  }
  if (!source.decoders || !source.requests)
    throw new Error("Missing public native creation codec.");
  for (const name of [
    "workingLocations",
    "runtimeMetadata",
    "project",
    "createdSession",
  ] as const) {
    if (typeof source.decoders[name] !== "function")
      throw new Error("Missing public native creation codec.");
  }
  for (const name of ["project", "session"] as const) {
    if (typeof source.requests[name] !== "function")
      throw new Error("Missing public native creation codec.");
  }
  const decoders = Object.freeze({ ...source.decoders });
  const validators = Object.freeze({ ...source.requests });
  const request = client.transport.request.bind(client.transport);
  const admit = client.transport.admit.bind(client.transport);
  return Object.freeze({
    listWorkingLocations: (signal?: AbortSignal) =>
      request<PublicNacWorkingLocation[]>("GET", "/public/working-locations", {
        signal,
        decodeJson: decoders.workingLocations,
      }),
    getRuntimeMetadata: (signal?: AbortSignal) =>
      request<PublicNacRuntimeMetadata>("GET", "/public/runtime-metadata", {
        signal,
        decodeJson: decoders.runtimeMetadata,
      }),
    createProject: (
      payload: PublicNacCreateProject,
      options: PublicNacCreationRequestOptions = {},
    ) => {
      // Frozen DTOs contain scalar fields only. Capture after canonical validation
      // and before any asynchronous credential refresh in the original transport.
      const body = Object.freeze({ ...validators.project(payload) });
      return admit<PublicNacProject>("POST", "/public/projects", {
        signal: options.signal,
        requestId: options.requestId,
        body,
        decodeJson: decoders.project,
      });
    },
    createSession: (
      payload: PublicNacCreateSession,
      options: PublicNacCreationRequestOptions = {},
    ) => {
      const body = Object.freeze({ ...validators.session(payload) });
      return admit<PublicNacCreatedSession>("POST", "/public/sessions", {
        signal: options.signal,
        requestId: options.requestId,
        body,
        decodeJson: decoders.createdSession,
      });
    },
  });
}

export type PublicNacCreationApi = ReturnType<typeof createPublicNacCreationApi>;
