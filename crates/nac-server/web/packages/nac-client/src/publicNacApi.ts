import type { NacClient } from "./nacClient.js";
import type {
  PublicNacModelCatalog,
  PublicNacModelConfiguration,
  PublicNacProject,
  PublicNacSessionConfig,
  PublicNacSessionSummary,
  PublicNacUiConfiguration,
} from "./publicNative.generated.js";

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
export function createPublicNacApi(
  client: Pick<NacClient, "transport">,
  source: PublicNacPresentationSource,
) {
  if (
    source.contract !== "public-native-v1" ||
    client.transport.jsonResponseDecodingVersion !== 1
  ) {
    throw new Error(
      "Public native presentation requires its explicit wire contract and response codec support.",
    );
  }
  if (!source.decoders) throw new Error("Missing public native response codec.");
  for (const name of [
    "uiConfiguration",
    "modelCatalog",
    "modelConfigs",
    "projects",
    "sessions",
    "sessionConfig",
  ] as const) {
    if (typeof source.decoders[name] !== "function")
      throw new Error("Missing public native response codec.");
  }
  const decoders = Object.freeze({ ...source.decoders });
  const request = client.transport.request.bind(client.transport);
  return Object.freeze({
    getUiConfiguration: (signal?: AbortSignal) =>
      request<PublicNacUiConfiguration>("GET", "/public/ui-config", {
        signal,
        decodeJson: decoders.uiConfiguration,
      }),
    getModelCatalog: (signal?: AbortSignal) =>
      request<PublicNacModelCatalog>("GET", "/public/models", {
        signal,
        decodeJson: decoders.modelCatalog,
      }),
    listModelConfigs: (signal?: AbortSignal) =>
      request<PublicNacModelConfiguration[]>("GET", "/public/model-configs", {
        signal,
        decodeJson: decoders.modelConfigs,
      }),
    listProjects: (signal?: AbortSignal) =>
      request<PublicNacProject[]>("GET", "/public/projects", {
        signal,
        decodeJson: decoders.projects,
      }),
    listSessions: (options: PublicNacSessionListOptions = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (options.projectId !== undefined) params.set("project_id", options.projectId);
      if (options.workspaceStats !== undefined) {
        params.set("workspace_stats", String(options.workspaceStats));
      }
      const query = params.size ? `?${params.toString()}` : "";
      return request<PublicNacSessionSummary[]>("GET", `/public/sessions${query}`, {
        signal,
        decodeJson: decoders.sessions,
      });
    },
    getSessionConfig: (sessionId: string, signal?: AbortSignal) =>
      request<PublicNacSessionConfig>(
        "GET",
        `/public/sessions/${encodeURIComponent(sessionId)}/config`,
        { signal, decodeJson: decoders.sessionConfig },
      ),
  });
}

export type PublicNacApi = ReturnType<typeof createPublicNacApi>;
