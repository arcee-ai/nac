import { useMutation, useQuery } from "@tanstack/react-query";

import { placeIdAt } from "@/app/lib/sessionOrder";
import { api } from "@/app/services/api";
import { useQueryInvalidators } from "@/app/services/queries/invalidation";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  CreateProjectRequest,
  DeleteProjectSessions,
  ProjectList,
  ProjectRecord,
  UpdateProjectRequest,
} from "@/app/types/api";

/**
 * Projects have no event stream, so this refetches on the same cadence as the
 * session list rather than polling: every project mutation invalidates it.
 */
export function useProjects() {
  return useQuery<ProjectList>({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => api.listProjects(signal),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateProject() {
  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: (payload: CreateProjectRequest) => api.createProject(payload),
    onSuccess: () => invalidate.projects(),
  });
}

export interface UpdateProjectVariables {
  projectId: string;
  payload: UpdateProjectRequest;
}

export function useUpdateProject() {
  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ projectId, payload }: UpdateProjectVariables) =>
      api.updateProject(projectId, payload),
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
  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ projectId, sessions }: DeleteProjectVariables) =>
      api.deleteProject(projectId, sessions),
    onSuccess: () => Promise.all([invalidate.projects(), invalidate.sessions()]),
  });
}

export interface AssignSessionVariables {
  projectId: string;
  sessionId: string;
}

export function useAssignSessionToProject() {
  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ projectId, sessionId }: AssignSessionVariables) =>
      api.assignSessionToProject(projectId, { session_id: sessionId }),
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
  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: async ({
      projects,
      projectId,
      targetPinned,
      targetIndex,
    }: MoveProjectOrderVariables) => {
      const moving = projects.find((project) => project.project_id === projectId);
      if (!moving) return;

      let current = projects;
      if (moving.pinned !== targetPinned) {
        await api.updateProject(projectId, { pinned: targetPinned });
        current = (await api.listProjects()).projects;
      }

      const group = current
        .filter((project) => project.pinned === targetPinned)
        .sort((a, b) => a.sort_order - b.sort_order);
      const ordered = placeIdAt(
        group.map((project) => project.project_id),
        projectId,
        targetIndex,
      );
      await api.reorderProjects({
        pinned: targetPinned,
        project_ids: ordered,
        expected_versions: Object.fromEntries(
          group.map((project) => [project.project_id, project.presentation_version]),
        ),
      });
    },
    onSuccess: () => invalidate.projects(),
  });
}
