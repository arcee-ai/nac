import type { ApiSchema } from "../../types/openapi.generated.js";
import type { PublicNacProject, PublicNacSessionSummary } from "../../../../packages/nac-client/src/publicNative.generated.js";
import type { PublicNacApi } from "../../../../packages/nac-client/src/publicNacApi.js";
export declare class UnsupportedCollectionCommand extends Error {
    constructor();
}
/** A closed read contract supplies no native mutation body or authority. */
export declare function requireNativeCollectionWire(publicSource: PublicNacApi | undefined): void;
export type NativeSessionSummary = ApiSchema<"SessionSummarySnapshot"> & {
    presentation?: "native";
};
export type NativeProject = ApiSchema<"ProjectRecord"> & {
    presentation?: "native";
};
/** Absent native fields stay absent; a presentation view is never a raw wire DTO. */
type OmittedNativeFields<Native, Public> = {
    [Key in Exclude<keyof Native, keyof Public | "presentation">]?: never;
};
export type PublicSessionSummaryView = PublicNacSessionSummary & OmittedNativeFields<NativeSessionSummary, PublicNacSessionSummary> & {
    presentation: "public";
};
export type SessionSummaryView = NativeSessionSummary | PublicSessionSummaryView;
export type PublicProjectView = PublicNacProject & OmittedNativeFields<NativeProject, PublicNacProject> & {
    presentation: "public";
};
export type ProjectView = NativeProject | PublicProjectView;
export type ProjectCollectionView = {
    projects: ProjectView[];
};
export type NativeManagedSessionView = ApiSchema<"ManagedSessionSummary"> & {
    summary: NativeSessionSummary;
};
export type PublicManagedSessionView = {
    summary: PublicSessionSummaryView;
    active?: never;
    active_run?: never;
    lineage?: never;
    workspace_diff?: never;
};
export type ManagedSessionView = NativeManagedSessionView | PublicManagedSessionView;
export declare function isNativeSessionView(entry: ManagedSessionView): entry is NativeManagedSessionView;
export declare function publicSessionView(summary: PublicNacSessionSummary): ManagedSessionView;
export declare function publicProjectView(project: PublicNacProject): PublicProjectView;
export declare function requireNativeSummary(summary: SessionSummaryView): NativeSessionSummary;
export declare function requireNativeProject(project: ProjectView): NativeProject;
export declare function comparePresentationOrder(left: number | string | undefined, right: number | string | undefined): number;
export {};
