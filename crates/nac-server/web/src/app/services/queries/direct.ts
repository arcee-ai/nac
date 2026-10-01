import { Atom } from "effect/reactivity";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import {
  idleAtom,
  nacAtoms,
  patchRemote,
  refreshPrefixed,
  remoteAtom,
  type Remote,
} from "@/app/effect/remote";
import { apiEffect } from "@/app/services/api";
import { atomIds } from "@/app/services/queries/keys";
import type {
  CreateGoalRequest,
  InboxDelivery,
  InboxItem,
  ManagedOrchestratorRecord,
  PermissionApprovalMode,
  PermissionReply,
  PermissionStateResponse,
  SessionGoalRecord,
  StartManagedOrchestratorRequest,
  StartTraditionalChildRequest,
  TraditionalChildRecord,
  UpdateGoalRequest,
} from "@/app/types/api";

const DETAIL_POLL_MS = 1_000;

function refreshed(registry: AtomRegistry.AtomRegistry, prefix: string) {
  return Effect.promise(() => refreshPrefixed(registry, prefix));
}

function mapItems<T>(update: (items: T[]) => T[]) {
  return (current: T[] | undefined) => update(current ?? []);
}

export const sessionPermissionsAtom = Atom.family((sessionId: string) =>
  remoteAtom(atomIds.permissions(sessionId), () => apiEffect.getPermissions(sessionId), {
    pollMs: DETAIL_POLL_MS,
    staleMs: 0,
    retry: false,
  }),
);

export function sessionPermissions(sessionId: string, enabled: boolean) {
  return enabled ? sessionPermissionsAtom(sessionId) : idleAtom<PermissionStateResponse>();
}

export const replyPermissionAtom = nacAtoms.fn(
  (input: { sessionId: string; requestId: string; reply: PermissionReply }, get) =>
    apiEffect
      .replyPermission(input.sessionId, input.requestId, input.reply)
      .pipe(Effect.tap(() => refreshed(get.registry, atomIds.permissions(input.sessionId)))),
);

export const setPermissionApprovalModeAtom = nacAtoms.fn(
  (input: { sessionId: string; mode: PermissionApprovalMode }, get) =>
    apiEffect.setPermissionApprovalMode(input.sessionId, input.mode).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          patchRemote(get.registry, sessionPermissionsAtom(input.sessionId), (current) =>
            current
              ? {
                  ...current,
                  approval_mode: input.mode,
                  requests: input.mode === "auto_approve" ? [] : current.requests,
                }
              : undefined,
          );
        }),
      ),
    ),
);

export const deletePermissionGrantAtom = nacAtoms.fn(
  (input: { sessionId: string; grantId: string }, get) =>
    apiEffect
      .deletePermissionGrant(input.sessionId, input.grantId)
      .pipe(Effect.tap(() => refreshed(get.registry, atomIds.permissions(input.sessionId)))),
);

export const sessionGoalAtom = Atom.family((sessionId: string): Remote<SessionGoalRecord | null> =>
  remoteAtom(atomIds.goal(sessionId), () => apiEffect.getGoal(sessionId), {
    pollMs: DETAIL_POLL_MS,
    retry: false,
  }),
);

export function sessionGoal(sessionId: string, enabled: boolean) {
  return enabled ? sessionGoalAtom(sessionId) : idleAtom<SessionGoalRecord | null>();
}

export const createGoalAtom = nacAtoms.fn(
  (input: { sessionId: string; payload: CreateGoalRequest }, get) =>
    apiEffect.createGoal(input.sessionId, input.payload).pipe(
      Effect.tap((goal) =>
        Effect.sync(() => {
          patchRemote(get.registry, sessionGoalAtom(input.sessionId), () => goal);
        }),
      ),
    ),
);

export const updateGoalAtom = nacAtoms.fn(
  (input: { sessionId: string; goalId: string; payload: UpdateGoalRequest }, get) =>
    apiEffect.updateGoal(input.sessionId, input.goalId, input.payload).pipe(
      Effect.tap((goal) =>
        Effect.sync(() => {
          patchRemote(get.registry, sessionGoalAtom(input.sessionId), () => goal);
        }),
      ),
    ),
);

export const clearGoalAtom = nacAtoms.fn(
  (input: { sessionId: string; goalId: string; expectedVersion: number }, get) =>
    apiEffect.clearGoal(input.sessionId, input.goalId, input.expectedVersion).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          patchRemote(get.registry, sessionGoalAtom(input.sessionId), () => null);
        }),
      ),
    ),
);

export const traditionalChildrenAtom = Atom.family((sessionId: string) =>
  remoteAtom(atomIds.children(sessionId), () => apiEffect.listTraditionalChildren(sessionId), {
    pollMs: DETAIL_POLL_MS,
    retry: false,
  }),
);

export function traditionalChildren(sessionId: string, enabled: boolean) {
  return enabled ? traditionalChildrenAtom(sessionId) : idleAtom<TraditionalChildRecord[]>();
}

export const startTraditionalChildAtom = nacAtoms.fn(
  (input: { sessionId: string; payload: StartTraditionalChildRequest }, get) =>
    apiEffect.startTraditionalChild(input.sessionId, input.payload).pipe(
      Effect.tap((child) =>
        Effect.sync(() => {
          patchRemote(
            get.registry,
            traditionalChildrenAtom(input.sessionId),
            mapItems((children) => {
              const without = children.filter(
                (candidate) => candidate.child_session_id !== child.child_session_id,
              );
              return [...without, child];
            }),
          );
        }),
      ),
    ),
);

export const cancelTraditionalChildAtom = nacAtoms.fn(
  (input: { sessionId: string; childId: string }, get) =>
    apiEffect.cancelTraditionalChild(input.sessionId, input.childId).pipe(
      Effect.tap((child) =>
        Effect.sync(() => {
          patchRemote(
            get.registry,
            traditionalChildrenAtom(input.sessionId),
            mapItems((children) =>
              children.map((candidate) =>
                candidate.child_session_id === child.child_session_id ? child : candidate,
              ),
            ),
          );
        }),
      ),
    ),
);

export const managedOrchestratorsAtom = Atom.family((sessionId: string) =>
  remoteAtom(
    atomIds.orchestrators(sessionId),
    () => apiEffect.listManagedOrchestrators(sessionId),
    { pollMs: DETAIL_POLL_MS, retry: false },
  ),
);

export function managedOrchestrators(sessionId: string, enabled: boolean) {
  return enabled ? managedOrchestratorsAtom(sessionId) : idleAtom<ManagedOrchestratorRecord[]>();
}

export const startManagedOrchestratorAtom = nacAtoms.fn(
  (input: { sessionId: string; payload: StartManagedOrchestratorRequest }, get) =>
    apiEffect.startManagedOrchestrator(input.sessionId, input.payload).pipe(
      Effect.tap((orchestrator) =>
        Effect.sync(() => {
          patchRemote(
            get.registry,
            managedOrchestratorsAtom(input.sessionId),
            mapItems((orchestrators) => {
              const without = orchestrators.filter(
                (candidate) =>
                  candidate.orchestrator_session_id !== orchestrator.orchestrator_session_id,
              );
              return [...without, orchestrator];
            }),
          );
        }),
      ),
    ),
);

export const cancelManagedOrchestratorAtom = nacAtoms.fn(
  (input: { sessionId: string; orchestratorId: string }, get) =>
    apiEffect.cancelManagedOrchestrator(input.sessionId, input.orchestratorId).pipe(
      Effect.tap((orchestrator) =>
        Effect.sync(() => {
          patchRemote(
            get.registry,
            managedOrchestratorsAtom(input.sessionId),
            mapItems((orchestrators) =>
              orchestrators.map((candidate) =>
                candidate.orchestrator_session_id === orchestrator.orchestrator_session_id
                  ? orchestrator
                  : candidate,
              ),
            ),
          );
        }),
      ),
    ),
);

export const sessionInboxAtom = Atom.family((sessionId: string) =>
  remoteAtom(atomIds.inbox(sessionId), () => apiEffect.listInbox(sessionId), {
    pollMs: DETAIL_POLL_MS,
    retry: false,
  }),
);

export function sessionInbox(sessionId: string, enabled: boolean) {
  return enabled ? sessionInboxAtom(sessionId) : idleAtom<InboxItem[]>();
}

export const createInboxItemAtom = nacAtoms.fn(
  (input: { sessionId: string; delivery: InboxDelivery; prompt: string }, get) =>
    apiEffect.createInboxItem(input.sessionId, input.delivery, input.prompt).pipe(
      Effect.tap((item) =>
        Effect.sync(() => {
          patchRemote(
            get.registry,
            sessionInboxAtom(input.sessionId),
            mapItems((items) => [...items.filter((candidate) => candidate.id !== item.id), item]),
          );
        }),
      ),
    ),
);

export const updateInboxItemAtom = nacAtoms.fn(
  (
    input: {
      sessionId: string;
      itemId: number;
      expectedVersion: number;
      delivery: InboxDelivery;
    },
    get,
  ) =>
    apiEffect
      .updateInboxItem(input.sessionId, input.itemId, input.expectedVersion, input.delivery)
      .pipe(
        Effect.tap((item) =>
          Effect.sync(() => {
            patchRemote(
              get.registry,
              sessionInboxAtom(input.sessionId),
              mapItems((items) =>
                items.map((candidate) => (candidate.id === item.id ? item : candidate)),
              ),
            );
          }),
        ),
      ),
);

export const cancelInboxItemAtom = nacAtoms.fn(
  (input: { sessionId: string; itemId: number; expectedVersion: number }, get) =>
    apiEffect.cancelInboxItem(input.sessionId, input.itemId, input.expectedVersion).pipe(
      Effect.tap((item) =>
        Effect.sync(() => {
          patchRemote(
            get.registry,
            sessionInboxAtom(input.sessionId),
            mapItems((items) =>
              items.map((candidate) => (candidate.id === item.id ? item : candidate)),
            ),
          );
        }),
      ),
    ),
);
