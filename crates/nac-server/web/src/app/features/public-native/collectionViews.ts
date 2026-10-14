import type { ApiSchema } from "@/app/types/openapi.generated";
import type {
  PublicNacProject,
  PublicNacSessionSummary,
} from "../../../../packages/nac-client/src/publicNative.generated.js";
import { publicNativeSortOrder } from "../../../../packages/nac-client/src/publicNativeInteger.js";
import type { PublicNacApi } from "../../../../packages/nac-client/src/publicNacApi.js";

export class UnsupportedCollectionCommand extends Error {
  constructor() {
    super("The selected interface does not support this action.");
  }
}

/** A closed read contract supplies no native mutation body or authority. */
export function requireNativeCollectionWire(publicSource: PublicNacApi | undefined): void {
  if (publicSource) throw new UnsupportedCollectionCommand();
}

export type NativeSessionSummary = ApiSchema<"SessionSummarySnapshot"> & {
  presentation?: "native";
};
export type NativeProject = ApiSchema<"ProjectRecord"> & { presentation?: "native" };

/** Absent native fields stay absent; a presentation view is never a raw wire DTO. */
type OmittedNativeFields<Native, Public> = {
  [Key in Exclude<keyof Native, keyof Public | "presentation">]?: never;
};
export type PublicSessionSummaryView = PublicNacSessionSummary &
  OmittedNativeFields<NativeSessionSummary, PublicNacSessionSummary> & {
    presentation: "public";
  };
export type SessionSummaryView = NativeSessionSummary | PublicSessionSummaryView;
export type PublicProjectView = PublicNacProject &
  OmittedNativeFields<NativeProject, PublicNacProject> & {
    presentation: "public";
  };
export type ProjectView = NativeProject | PublicProjectView;
export type ProjectCollectionView = { projects: ProjectView[] };
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

export function isNativeSessionView(entry: ManagedSessionView): entry is NativeManagedSessionView {
  return entry.summary.presentation !== "public";
}

export function publicSessionView(summary: PublicNacSessionSummary): ManagedSessionView {
  return { summary: { ...summary, presentation: "public" } };
}
export function publicProjectView(project: PublicNacProject): PublicProjectView {
  return { ...project, presentation: "public" };
}

export function requireNativeSummary(summary: SessionSummaryView): NativeSessionSummary {
  if (summary.presentation === "public") throw new UnsupportedCollectionCommand();
  return summary;
}
export function requireNativeProject(project: ProjectView): NativeProject {
  if (project.presentation === "public") throw new UnsupportedCollectionCommand();
  return project;
}

export function comparePresentationOrder(
  left: number | string | undefined,
  right: number | string | undefined,
): number {
  const a = left ?? 0;
  const b = right ?? 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const integer = (value: number | string) => {
    if (typeof value === "string") return publicNativeSortOrder(value);
    if (!Number.isSafeInteger(value))
      throw new Error("Presentation order is outside the exact numeric range.");
    return BigInt(value);
  };
  const first = integer(a);
  const second = integer(b);
  return first < second ? -1 : first > second ? 1 : 0;
}
