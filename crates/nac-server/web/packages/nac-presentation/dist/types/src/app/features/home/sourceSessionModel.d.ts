import type { ManagedSessionSummary, ProjectRecord, ProjectSessionModelSource } from "../../types/api";
import type { ModelOverride } from "./modelChoice";
import type { NativeApi } from "../../services/api";
/** Only an ordinary top-level session in the same project and workspace can supply a visible starting selection. */
export declare function eligibleSource(entry: ManagedSessionSummary, project: ProjectRecord): boolean;
export declare function sourceSelection(config: ProjectSessionModelSource, source: ManagedSessionSummary): ModelOverride | null;
export declare function useSourceSessionModel(project: ProjectRecord | null, sessions: readonly ManagedSessionSummary[], preferred: string | null): {
    model: ModelOverride | null;
    pending: boolean;
    hasSource: boolean;
    error: boolean;
};
/** Recheck a sourced choice immediately before a new write; no mutation occurs on failure. */
export declare function requireCurrentSource(api: Pick<NativeApi, "getProjectSessionModelSource">, projectId: string, model: ModelOverride, signal: AbortSignal): Promise<void>;
