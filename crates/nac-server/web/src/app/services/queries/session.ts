import { Atom } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/reactivity";
import {
  idleAtom,
  nacAtoms,
  patchRemote,
  peekById,
  prefixedIds,
  refreshPrefixed,
  remoteAtom,
  resetPrefixed,
  valueOf,
  type Remote,
} from "@/app/effect/remote";
import {
  SNAPSHOT_MESSAGE_LIMIT,
  SNAPSHOT_THREAD_EVENT_LIMIT,
  mergeFocusedSnapshot,
  prependMessagePage,
  validMessagesPage,
  validSnapshotWindow,
} from "@/app/lib/messageWindow";
import {
  pinGroup,
  placeIdAt,
  reorderRequest,
  sameOrder,
  withUpdatedSummary,
} from "@/app/lib/sessionOrder";
import { apiEffect } from "@/app/services/api";
import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { SESSIONS_POLL_MS, WORKSPACE_STATS_POLL_MS } from "@/app/services/queries/keys";
import {
  beginSnapshotFetch,
  currentSessionGeneration,
  fenceSessionSnapshot,
  finishSnapshotFetch,
  isCurrentSessionGeneration,
} from "@/app/services/sessionRefresh";
import {
  finishRunCancel,
  requestRunCancel,
  restoreRunCancel,
  setOptimisticUserPrompt,
} from "@/app/store/runtimeStore";
import type {
  CreateSessionRequest,
  ManagedSessionSummary,
  RawSessionConfig,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  ThreadEventPage,
  UpdateConfigRequest,
} from "@/app/types/api";

export function sessionRoot(id: string): string {
  return `session\0${id}`;
}

export function mergeWorkspaceStats(
  base: ManagedSessionSummary[],
  stats: ManagedSessionSummary[],
): ManagedSessionSummary[] {
  const workspaceById = new Map(
    stats
      .filter((entry) => entry.workspace_diff !== undefined)
      .map((entry) => [entry.summary.session_id, entry.workspace_diff]),
  );
  return base.map((entry) => {
    const workspaceDiff = workspaceById.get(entry.summary.session_id);
    return workspaceDiff === undefined ? entry : { ...entry, workspace_diff: workspaceDiff };
  });
}

export const sessionsAtom = Atom.family((pollMs: number): Remote<ManagedSessionSummary[]> =>
  remoteAtom(`sessions\u0000${pollMs}\u00000`, () => apiEffect.listSessions({}), {
    pollMs,
    staleMs: 0,
    retry: false,
  }),
);

export const sessionStatsAtom = Atom.family((pollMs: number): Remote<ManagedSessionSummary[]> =>
  remoteAtom(
    `sessions\u0000${pollMs}\u00001`,
    () => apiEffect.listSessions({ workspaceStats: true }),
    { pollMs, staleMs: pollMs, retry: false },
  ),
);

export function sessionsWithStatsKey(
  baseMs = SESSIONS_POLL_MS,
  statsMs = WORKSPACE_STATS_POLL_MS,
): string {
  return `${baseMs}:${statsMs}`;
}

export const sessionsWithStatsAtom = Atom.family((key: string) => {
  const [baseMs, statsMs] = key.split(":").map(Number);
  return Atom.make((get) => {
    const base = get(sessionsAtom(baseMs));
    const stats = get(sessionStatsAtom(statsMs));
    if (!AsyncResult.isSuccess(base)) return base;
    return AsyncResult.success(mergeWorkspaceStats(base.value, valueOf(stats) ?? []), {
      waiting: base.waiting || stats.waiting,
      timestamp: base.timestamp,
    });
  });
});

export function selectSession(
  list: AsyncResult.AsyncResult<ManagedSessionSummary[], unknown>,
  id: string | null,
): ManagedSessionSummary | null | undefined {
  if (!id || !AsyncResult.isSuccess(list)) return undefined;
  return list.value.find((item) => item.summary.session_id === id) ?? null;
}

export const sessionSnapshotAtom = Atom.family((id: string) =>
  remoteAtom(
    `${sessionRoot(id)}\0snapshot`,
    (_get, current: SessionSnapshotResponse | undefined) => {
      const program = Effect.gen(function* () {
        const token = beginSnapshotFetch(id);
        const incoming = yield* apiEffect.getSession(id, {
          messageLimit: SNAPSHOT_MESSAGE_LIMIT,
          threadEventLimit: SNAPSHOT_THREAD_EVENT_LIMIT,
          includeSessions: false,
          includeSystem: true,
        });
        if (!validSnapshotWindow(incoming)) {
          return yield* Effect.fail(
            new Error("The server returned an invalid snapshot message page."),
          );
        }
        if (!isCurrentSessionGeneration(id, token.generation)) {
          return yield* Effect.fail(new DOMException("Snapshot superseded", "AbortError"));
        }
        finishSnapshotFetch(id, token);
        return mergeFocusedSnapshot(current, incoming, token.replace);
      });
      return program;
    },
    { staleMs: 1_000, retry: false },
  ),
);

export function snapshotAtom(id: string | null) {
  return id ? sessionSnapshotAtom(id) : idleAtom<SessionSnapshotResponse>();
}

/** True when the older page still joined the cursor that requested it. */
export const olderMessagesAtom = nacAtoms.fn((id: string, get) =>
  Effect.gen(function* () {
    const current = valueOf(get(sessionSnapshotAtom(id)));
    const start = current?.message_page?.start;
    if (start === undefined || start <= 0) {
      return yield* Effect.fail(new Error("No older messages are available."));
    }
    const generation = currentSessionGeneration(id);
    const page = yield* apiEffect.getMessages(id, {
      before: start,
      limit: SNAPSHOT_MESSAGE_LIMIT,
      includeSystem: true,
    });
    if (!validMessagesPage(page)) {
      return yield* Effect.fail(new Error("The server returned an invalid message page."));
    }
    if (!isCurrentSessionGeneration(id, generation)) return false;
    const latest = valueOf(get(sessionSnapshotAtom(id)));
    if (!latest) return false;
    const merged = prependMessagePage(latest, page, start);
    if (!merged) return false;
    get.set(sessionSnapshotAtom(id), AsyncResult.success(merged));
    return true;
  }),
);

export interface ThreadHistory {
  readonly pages: readonly ThreadEventPage[];
  readonly pageParams: readonly (number | null)[];
}

export function threadEventsKey(id: string, name: string): string {
  return `${id}\0${name}`;
}

export const threadEventsAtom = Atom.family((key: string) => {
  const separator = key.indexOf("\0");
  const id = key.slice(0, separator);
  const name = key.slice(separator + 1);
  return remoteAtom<ThreadHistory>(
    `${sessionRoot(id)}\0thread-events\0${name}`,
    () =>
      apiEffect
        .getThreadEvents(id, name, { limit: SNAPSHOT_THREAD_EVENT_LIMIT })
        .pipe(Effect.map((page) => ({ pages: [page], pageParams: [null] }))),
    { staleMs: Number.POSITIVE_INFINITY, retry: false, refreshOnMount: false },
  );
});

export function threadEventsFor(id: string | null, name: string | null) {
  return id && name ? threadEventsAtom(threadEventsKey(id, name)) : idleAtom<ThreadHistory>();
}

export const olderThreadEventsAtom = nacAtoms.fn((key: string, get) =>
  Effect.gen(function* () {
    const separator = key.indexOf("\0");
    const id = key.slice(0, separator);
    const name = key.slice(separator + 1);
    const current = valueOf(get(threadEventsAtom(key)));
    const last = current?.pages.at(-1);
    const beforeId = last?.has_older ? last.next_before_id : null;
    if (beforeId == null || !current) return current ?? null;
    const page = yield* apiEffect.getThreadEvents(id, name, {
      limit: SNAPSHOT_THREAD_EVENT_LIMIT,
      beforeId,
    });
    const latest = valueOf(get(threadEventsAtom(key)));
    if (!latest || latest.pages.at(-1)?.next_before_id !== beforeId) return latest;
    const next = {
      pages: [...latest.pages, page],
      pageParams: [...latest.pageParams, beforeId],
    };
    get.set(threadEventsAtom(key), AsyncResult.success(next));
    return next;
  }),
);

export const sessionConfigAtom = Atom.family((id: string): Remote<RawSessionConfig> =>
  remoteAtom(`${sessionRoot(id)}\0config`, () => apiEffect.getConfig(id), { retry: false }),
);

export function configAtom(id: string | null) {
  return id ? sessionConfigAtom(id) : idleAtom<RawSessionConfig>();
}

function refreshSessions(registry: AtomRegistry.AtomRegistry) {
  return refreshPrefixed(registry, "sessions");
}

function refreshSession(registry: AtomRegistry.AtomRegistry, id: string) {
  return refreshPrefixed(registry, sessionRoot(id));
}

export const createSessionAtom = nacAtoms.fn((payload: CreateSessionRequest, get) =>
  apiEffect
    .createSession(payload)
    .pipe(Effect.tap(() => Effect.promise(() => refreshSessions(get.registry)))),
);

function sourcesShowingFork(registry: AtomRegistry.AtomRegistry, forkId: string): string[] {
  const ids: string[] = [];
  for (const cacheId of prefixedIds(registry, "session")) {
    if (!cacheId.endsWith("\0snapshot")) continue;
    const sessionId = cacheId.split("\0")[1];
    if (!sessionId || sessionId === forkId) continue;
    const snapshot = valueOf(peekById(registry, cacheId) ?? AsyncResult.initial(false));
    const forks = (snapshot as SessionSnapshotResponse | undefined)?.forks;
    if (!forks?.some((fork) => fork.session_id === forkId)) continue;
    ids.push(sessionId);
  }
  return ids;
}

export const deleteSessionAtom = nacAtoms.fn((id: string, get) =>
  apiEffect.deleteSession(id).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        const sources = sourcesShowingFork(get.registry, id);
        resetPrefixed(get.registry, sessionRoot(id));
        for (const sourceId of sources) void refreshSession(get.registry, sourceId);
      }),
    ),
    Effect.tap(() => Effect.promise(() => refreshSessions(get.registry))),
  ),
);

export interface RenameSessionVariables {
  id: string;
  title: string;
  pinned: boolean;
  expectedVersion: number;
}

export const updatePresentationAtom = nacAtoms.fn((input: RenameSessionVariables, get) =>
  apiEffect
    .updatePresentation(input.id, {
      title: input.title,
      pinned: input.pinned,
      expected_version: input.expectedVersion,
    })
    .pipe(Effect.tap(() => Effect.promise(() => refreshSessions(get.registry)))),
);

export const togglePinAtom = nacAtoms.fn((summary: SessionSummarySnapshot, get) =>
  apiEffect
    .updatePresentation(summary.session_id, {
      title: summary.title ?? "",
      pinned: !summary.pinned,
      expected_version: summary.presentation_version ?? 0,
    })
    .pipe(Effect.tap(() => Effect.promise(() => refreshSessions(get.registry)))),
);

export interface MoveSessionOrderVariables {
  sessions: ManagedSessionSummary[];
  sessionId: string;
  targetPinned: boolean;
  targetIndex: number;
}

export const moveSessionOrderAtom = nacAtoms.fn((input: MoveSessionOrderVariables, get) =>
  Effect.gen(function* () {
    let entries = input.sessions;
    const entry = entries.find((item) => item.summary.session_id === input.sessionId);
    if (!entry) return yield* Effect.fail(new Error(`Session '${input.sessionId}' was not found`));
    if (Boolean(entry.summary.pinned) !== input.targetPinned) {
      const summary = yield* apiEffect.updatePresentation(input.sessionId, {
        title: entry.summary.title ?? "",
        pinned: input.targetPinned,
        expected_version: entry.summary.presentation_version ?? 0,
      });
      entries = withUpdatedSummary(entries, summary);
    }
    const group = pinGroup(entries, input.targetPinned);
    const currentIds = group.map((item) => item.summary.session_id);
    const nextIds = placeIdAt(currentIds, input.sessionId, input.targetIndex);
    if (sameOrder(currentIds, nextIds)) {
      yield* Effect.promise(() => refreshSessions(get.registry));
      return null;
    }
    const response = yield* apiEffect.reorderSessions(
      reorderRequest(input.targetPinned, nextIds, group),
    );
    yield* Effect.promise(() => refreshSessions(get.registry));
    return response;
  }),
);

export const updateSessionConfigAtom = nacAtoms.fn(
  (input: { id: string; patch: UpdateConfigRequest }, get) =>
    apiEffect.updateConfig(input.id, input.patch).pipe(
      Effect.tap(() =>
        Effect.promise(() => refreshPrefixed(get.registry, `${sessionRoot(input.id)}\0config`)),
      ),
      Effect.tap(() => Effect.promise(() => refreshSession(get.registry, input.id))),
      Effect.tap(() => Effect.promise(() => refreshSessions(get.registry))),
    ),
);

export const submitRunAtom = nacAtoms.fn((input: { id: string; prompt: string }, get) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => setOptimisticUserPrompt(input.prompt));
    const admission = yield* apiEffect.submitRun(input.id, input.prompt);
    if (admission.status === "accepted") {
      yield* Effect.promise(() => refreshSession(get.registry, input.id));
      return admission.response;
    }
    if (admission.status === "not-sent") {
      yield* Effect.sync(() => setOptimisticUserPrompt(null));
      return yield* Effect.fail(
        new DOMException("Prompt submission was cancelled before it was sent.", "AbortError"),
      );
    }
    fenceSessionSnapshot(input.id, true);
    yield* Effect.promise(() => refreshSession(get.registry, input.id));
    return yield* Effect.fail(
      new UncertainCommandAdmissionError(admission.requestId, admission.error),
    );
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (!(error instanceof UncertainCommandAdmissionError)) setOptimisticUserPrompt(null);
      }),
    ),
  ),
);

export const steerOrchestratorAtom = nacAtoms.fn((input: { id: string; instruction: string }) =>
  apiEffect.steerOrchestrator(input.id, input.instruction),
);

export const steerThreadAtom = nacAtoms.fn(
  (input: { id: string; threadName: string; instruction: string }) =>
    apiEffect.steerThread(input.id, input.threadName, input.instruction),
);

export const cancelRunAtom = nacAtoms.fn((id: string, get) =>
  Effect.gen(function* () {
    const runtime = requestRunCancel();
    const snapshot = valueOf(get(sessionSnapshotAtom(id)));
    const sessions = valueOf(get(sessionsAtom(SESSIONS_POLL_MS)));
    const sessionsWithStats = valueOf(get(sessionStatsAtom(WORKSPACE_STATS_POLL_MS)));
    clearCachedActiveRun(get.registry, id);
    const exit = yield* Effect.exit(apiEffect.cancelActiveRun(id));
    if (exit._tag === "Failure") {
      restoreRunCancel(runtime);
      if (snapshot) get.set(sessionSnapshotAtom(id), AsyncResult.success(snapshot));
      if (sessions) get.set(sessionsAtom(SESSIONS_POLL_MS), AsyncResult.success(sessions));
      if (sessionsWithStats) {
        get.set(sessionStatsAtom(WORKSPACE_STATS_POLL_MS), AsyncResult.success(sessionsWithStats));
      }
      return yield* Effect.failCause(exit.cause);
    }
    finishRunCancel();
    yield* Effect.promise(() => refreshSession(get.registry, id));
    yield* Effect.promise(() => refreshSessions(get.registry));
  }),
);

function idleSessionEntry(entry: ManagedSessionSummary, sessionId: string): ManagedSessionSummary {
  if (entry.summary.session_id !== sessionId) return entry;
  if (!entry.active && entry.active_run === undefined) return entry;
  return { ...entry, active: false, active_run: undefined };
}

function clearCachedActiveRun(registry: AtomRegistry.AtomRegistry, sessionId: string): void {
  patchRemote(
    registry,
    sessionSnapshotAtom(sessionId) as Remote<SessionSnapshotResponse, unknown>,
    (current) => (current?.active_run ? { ...current, active_run: undefined } : current),
  );
  patchRemote(registry, sessionsAtom(SESSIONS_POLL_MS), (current) =>
    current?.map((entry) => idleSessionEntry(entry, sessionId)),
  );
  patchRemote(registry, sessionStatsAtom(WORKSPACE_STATS_POLL_MS), (current) =>
    current?.map((entry) => idleSessionEntry(entry, sessionId)),
  );
}

function rewriteSession(id: string, registry: AtomRegistry.AtomRegistry) {
  fenceSessionSnapshot(id, true);
  return refreshSession(registry, id);
}

export const compactSessionAtom = nacAtoms.fn((id: string, get) =>
  apiEffect
    .compactSession(id)
    .pipe(Effect.tap(() => Effect.promise(() => rewriteSession(id, get.registry)))),
);

export const revertSessionAtom = nacAtoms.fn((input: { id: string; messageIdx: number }, get) =>
  apiEffect.revertSession(input.id, input.messageIdx).pipe(
    Effect.tap(() => Effect.promise(() => rewriteSession(input.id, get.registry))),
    Effect.tap(() => Effect.promise(() => refreshSessions(get.registry))),
  ),
);

export const regenerateRunAtom = nacAtoms.fn((input: { id: string; messageIdx: number }, get) =>
  apiEffect.regenerateRun(input.id, input.messageIdx).pipe(
    Effect.tap(() => Effect.promise(() => rewriteSession(input.id, get.registry))),
    Effect.tap(() => Effect.promise(() => refreshSessions(get.registry))),
  ),
);

export const forkSessionAtom = nacAtoms.fn((input: { id: string; messageIdx: number }, get) =>
  apiEffect.forkSession(input.id, input.messageIdx).pipe(
    Effect.tap(() => Effect.promise(() => refreshSession(get.registry, input.id))),
    Effect.tap(() => Effect.promise(() => refreshSessions(get.registry))),
  ),
);

export const dismissSessionForkAtom = nacAtoms.fn((input: { id: string; forkId: string }, get) =>
  apiEffect
    .dismissSessionFork(input.id, input.forkId)
    .pipe(Effect.tap(() => Effect.promise(() => refreshSession(get.registry, input.id)))),
);
