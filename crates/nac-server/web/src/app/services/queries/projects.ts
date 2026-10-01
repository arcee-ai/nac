import { Effect } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import { nacAtoms, remoteAtom } from "@/app/effect/remote";
import { placeIdAt } from "@/app/lib/sessionOrder";
import { apiEffect } from "@/app/services/api";
import { refreshProjects, refreshSessionList } from "@/app/services/queries/invalidation";
import { atomIds } from "@/app/services/queries/keys";
import type {
  CreateProjectRequest,
  DeleteProjectSessions,
  ProjectRecord,
  UpdateProjectRequest,
} from "@/app/types/api";

function refreshProjectsAndSessions(registry: AtomRegistry.AtomRegistry) {
  return Promise.all([refreshProjects(registry), refreshSessionList(registry)]).then(
    () => undefined,
  );
}

/**
 * Projects have no event stream, so this refetches on the same cadence as the
 * session list rather than polling: every project mutation refreshes it.
 */
export const projectsAtom = remoteAtom(atomIds.projects, () => apiEffect.listProjects(), {
  staleMs: 30_000,
  retry: false,
});

export const createProjectAtom = nacAtoms.fn((payload: CreateProjectRequest, get) =>
  apiEffect
    .createProject(payload)
    .pipe(Effect.tap(() => Effect.promise(() => refreshProjects(get.registry)))),
);

export interface UpdateProjectVariables {
  projectId: string;
  payload: UpdateProjectRequest;
}

export const updateProjectAtom = nacAtoms.fn((input: UpdateProjectVariables, get) =>
  apiEffect
    .updateProject(input.projectId, input.payload)
    .pipe(Effect.tap(() => Effect.promise(() => refreshProjects(get.registry)))),
);

/** Pin toggle mirrors the session one: same shape, no title to preserve. */
export const toggleProjectPinAtom = nacAtoms.fn((project: ProjectRecord, get) =>
  apiEffect
    .updateProject(project.project_id, { pinned: !project.pinned })
    .pipe(Effect.tap(() => Effect.promise(() => refreshProjects(get.registry)))),
);

export interface DeleteProjectVariables {
  projectId: string;
  /** Whether the project's chats go with it. Defaults to keeping them. */
  sessions?: DeleteProjectSessions;
}

/** Either way the project's sessions move, so the session list moves too. */
export const deleteProjectAtom = nacAtoms.fn((input: DeleteProjectVariables, get) =>
  apiEffect
    .deleteProject(input.projectId, input.sessions)
    .pipe(Effect.tap(() => Effect.promise(() => refreshProjectsAndSessions(get.registry)))),
);

export interface AssignSessionVariables {
  projectId: string;
  sessionId: string;
}

export const assignSessionToProjectAtom = nacAtoms.fn((input: AssignSessionVariables, get) =>
  apiEffect
    .assignSessionToProject(input.projectId, { session_id: input.sessionId })
    .pipe(Effect.tap(() => Effect.promise(() => refreshProjectsAndSessions(get.registry)))),
);

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
export const moveProjectOrderAtom = nacAtoms.fn((input: MoveProjectOrderVariables, get) =>
  Effect.gen(function* () {
    const moving = input.projects.find((project) => project.project_id === input.projectId);
    if (!moving) return;

    let current = input.projects;
    if (moving.pinned !== input.targetPinned) {
      yield* apiEffect.updateProject(input.projectId, { pinned: input.targetPinned });
      current = (yield* apiEffect.listProjects()).projects;
    }

    const group = current
      .filter((project) => project.pinned === input.targetPinned)
      .sort((a, b) => a.sort_order - b.sort_order);
    const ordered = placeIdAt(
      group.map((project) => project.project_id),
      input.projectId,
      input.targetIndex,
    );
    yield* apiEffect.reorderProjects({
      pinned: input.targetPinned,
      project_ids: ordered,
      expected_versions: Object.fromEntries(
        group.map((project) => [project.project_id, project.presentation_version]),
      ),
    });
  }).pipe(Effect.tap(() => Effect.promise(() => refreshProjects(get.registry)))),
);
