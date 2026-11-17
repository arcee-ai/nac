export declare const RANGE_ANY = "any";
export declare const SORT_DEFAULT = "default";
import { type SessionEnv } from "../lib/format";
import type { ProjectListItem } from "../lib/projects";
import type { ManagedSessionSummary } from "../types/api";
export type SortId = typeof SORT_DEFAULT | "created_desc" | "created_asc" | "updated_desc" | "title_asc";
export type RangeId = typeof RANGE_ANY | "24h" | "7d" | "30d";
interface FiltersState {
    query: string;
    sort: SortId;
    createdRange: RangeId;
    modifiedRange: RangeId;
    envs: SessionEnv[];
    /** Selected `BackendKind` values, not their display labels. */
    providers: string[];
}
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createSessionFiltersStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    SORT_DEFAULT: string;
    SORT_ITEMS: {
        id: SortId;
        label: string;
    }[];
    RANGE_ITEMS: {
        id: RangeId;
        label: string;
    }[];
    sessionFiltersStore: import("../lib/store").Store<FiltersState>;
    setQuery: (query: string) => void;
    setSort: (sort: SortId) => void;
    setCreatedRange: (createdRange: RangeId) => void;
    setModifiedRange: (modifiedRange: RangeId) => void;
    toggleEnv: (env: SessionEnv) => void;
    toggleProvider: (provider: string) => void;
    resetFilters: () => void;
    hasActiveFilters: () => boolean;
    useVisibleSessions: (sessions: ManagedSessionSummary[]) => ManagedSessionSummary[];
    useVisibleProjectItems: (items: ProjectListItem[]) => ProjectListItem[];
    useSessionProviders: (sessions: ManagedSessionSummary[]) => string[];
    useSessionEnvs: (sessions: ManagedSessionSummary[]) => SessionEnv[];
    pruneUnavailableFacets: (availableEnvs: readonly SessionEnv[], availableProviders: readonly string[]) => void;
    useFilterQuery: () => string;
    useSort: () => SortId;
    useCreatedRange: () => RangeId;
    useModifiedRange: () => RangeId;
    useSelectedEnvs: () => ("Local" | "SSH" | "Sandbox")[];
    useSelectedProviders: () => string[];
    useIsDefaultSort: () => boolean;
};
export declare const release: () => void, SORT_ITEMS: {
    id: SortId;
    label: string;
}[], RANGE_ITEMS: {
    id: RangeId;
    label: string;
}[], sessionFiltersStore: import("../lib/store").Store<FiltersState>, setQuery: (query: string) => void, setSort: (sort: SortId) => void, setCreatedRange: (createdRange: RangeId) => void, setModifiedRange: (modifiedRange: RangeId) => void, toggleEnv: (env: SessionEnv) => void, toggleProvider: (provider: string) => void, resetFilters: () => void, hasActiveFilters: () => boolean, useVisibleSessions: (sessions: ManagedSessionSummary[]) => ManagedSessionSummary[], useVisibleProjectItems: (items: ProjectListItem[]) => ProjectListItem[], useSessionProviders: (sessions: ManagedSessionSummary[]) => string[], useSessionEnvs: (sessions: ManagedSessionSummary[]) => SessionEnv[], pruneUnavailableFacets: (availableEnvs: readonly SessionEnv[], availableProviders: readonly string[]) => void, useFilterQuery: () => string, useSort: () => SortId, useCreatedRange: () => RangeId, useModifiedRange: () => RangeId, useSelectedEnvs: () => ("Local" | "SSH" | "Sandbox")[], useSelectedProviders: () => string[], useIsDefaultSort: () => boolean;
export {};
