import type {
  ProjectCollectionView as ProjectList,
  ProjectView as ProjectRecord,
} from "@/app/features/public-native/collectionViews";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useMutation, useQuery } from "@tanstack/react-query";

import { placeIdAt } from "@/app/lib/sessionOrder";
import {
  publicProjectView,
  requireNativeProject,
  comparePresentationOrder,
  requireNativeCollectionWire,
} from "@/app/features/public-native/collectionViews";

import { useQueryInvalidators } from "@/app/services/queries/invalidation";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  CreateProjectRequest,
  DeleteProjectSessions,
  UpdateProjectRequest,
} from "@/app/types/api";

/**
 * Projects have no event stream, so this refetches on the same cadence as the
 * session list rather than polling: every project mutation invalidates it.
 */
export function useProjects() {
  const { api, publicPresentation } = useNativeRuntime();

  return useQuery<ProjectList>({
    queryKey: queryKeys.projects,
    queryFn: async ({ signal }) =>
      publicPresentation
        ? { projects: (await publicPresentation.listProjects(signal)).map(publicProjectView) }
        : api.listProjects(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateProject() {
  const { api, publicPresentation } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    retry: false,
    mutationFn: (payload: CreateProjectRequest) => {
      requireNativeCollectionWire(publicPresentation);
      return api.createProject(payload);
    },
    onSuccess: () => invalidate.projects(),
  });
}

export interface UpdateProjectVariables {
  projectId: string;
  payload: UpdateProjectRequest;
}

export function useUpdateProject() {
  const { api, publicPresentation } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    retry: false,
    mutationFn: ({ projectId, payload }: UpdateProjectVariables) => {
      requireNativeCollectionWire(publicPresentation);
      return api.updateProject(projectId, payload);
    },
    onSuccess: () => invalidate.projects(),
  });
}

/** Pin toggle mirrors the session one: same shape, no title to preserve. */
export function useToggleProjectPin() {
  const update = useUpdateProject();
  return {
    ...update,
    toggle: (project: ProjectRecord) =>
      update.mutateAsync({
        projectId: project.project_id,
        payload: { pinned: !project.pinned },
      }),
  };
}

export interface DeleteProjectVariables {
  projectId: string;
  /** Whether the project's chats go with it. Defaults to keeping them. */
  sessions?: DeleteProjectSessions;
}

/** Either way the project's sessions move, so the session list moves too. */
export function useDeleteProject() {
  const { api, publicPresentation } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ projectId, sessions }: DeleteProjectVariables) => {
      requireNativeCollectionWire(publicPresentation);
      return api.deleteProject(projectId, sessions);
    },
    onSuccess: () => Promise.all([invalidate.projects(), invalidate.sessions()]),
  });
}

export interface AssignSessionVariables {
  projectId: string;
  sessionId: string;
}

export function useAssignSessionToProject() {
  const { api, publicPresentation } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ projectId, sessionId }: AssignSessionVariables) => {
      requireNativeCollectionWire(publicPresentation);
      return api.assignSessionToProject(projectId, { session_id: sessionId });
    },
    onSuccess: () => Promise.all([invalidate.projects(), invalidate.sessions()]),
  });
}

export interface MoveProjectOrderVariables {
  /** Full list — `/projects/order` requires entire pin-group membership. */
  projects: ProjectRecord[];
  projectId: string;
  targetPinned: boolean;
  /** Index within the destination pin group after the move. */
  targetIndex: number;
}

/**
 * Reorder within a pin group, pinning or unpinning first when the destination
 * group differs. The pin toggle rewrites versions, so the group is re-read from
 * its response before the order request is built.
 */
export function useMoveProjectOrder() {
  const { api, publicPresentation } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: async ({
      projects,
      projectId,
      targetPinned,
      targetIndex,
    }: MoveProjectOrderVariables) => {
      requireNativeCollectionWire(publicPresentation);
      const moving = projects.find((project) => project.project_id === projectId);
      if (!moving) return;

      let current = projects;
      if (moving.pinned !== targetPinned) {
        await api.updateProject(projectId, { pinned: targetPinned });
        current = (await api.listProjects()).projects;
      }

      const group = current
        .filter((project) => project.pinned === targetPinned)
        .sort((a, b) => comparePresentationOrder(a.sort_order, b.sort_order));
      const ordered = placeIdAt(
        group.map((project) => project.project_id),
        projectId,
        targetIndex,
      );
      await api.reorderProjects({
        pinned: targetPinned,
        project_ids: ordered,
        expected_versions: Object.fromEntries(
          group.map((project) => [
            project.project_id,
            requireNativeProject(project).presentation_version,
          ]),
        ),
      });
    },
    onSuccess: () => invalidate.projects(),
  });
}
