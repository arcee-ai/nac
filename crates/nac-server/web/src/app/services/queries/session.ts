import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  createChat,
  runCommand,
  submitPrompt,
  stopRun,
} from "@/app/features/direct-session/commandWorkflow";
import { makeStopPorts } from "@/app/features/direct-session/commandAdapters";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { visibleSessions } from "@/app/features/ui-policy/policy";
import { useCallback, useMemo } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  type InfiniteData,
  type QueryClient,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

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

import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { useQueryInvalidators } from "@/app/services/queries/invalidation";
import { queryKeys, SESSIONS_POLL_MS, WORKSPACE_STATS_POLL_MS } from "@/app/services/queries/keys";
import {
  beginSnapshotFetch,
  beginHistoryFetch,
  finishHistoryFetch,
  fenceSessionSnapshot,
  finishSnapshotFetch,
  isCurrentSessionGeneration,
  sessionRefreshKey,
} from "@/app/services/sessionRefresh";

import type {
  CreateSessionRequest,
  ManagedSessionSummary,
  RawSessionConfig,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  ThreadEventPage,
  UpdateConfigRequest,
} from "@/app/types/api";

export function useSessions(pollMs = SESSIONS_POLL_MS) {
  const { api } = useNativeRuntime();

  return useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(false),
    queryFn: ({ signal }) => api.listSessions({}, signal),
    refetchInterval: pollMs,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
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

export function useSessionsWithWorkspaceStats(
  cadence: {
    baseMs: number;
    statsMs: number;
  } = {
    baseMs: SESSIONS_POLL_MS,
    statsMs: WORKSPACE_STATS_POLL_MS,
  },
) {
  const { api } = useNativeRuntime();

  const base = useSessions(cadence.baseMs);
  const stats = useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(true),
    queryFn: ({ signal }) => api.listSessions({ workspaceStats: true }, signal),
    refetchInterval: cadence.statsMs,
    staleTime: cadence.statsMs,
  });
  const data = useMemo(
    () => (base.data ? mergeWorkspaceStats(base.data, stats.data ?? []) : base.data),
    [base.data, stats.data],
  );
  return { ...base, data };
}

/**
 * The single summary a session screen needs, picked out of the polled list.
 *
 * Subscribing to the whole list would re-render the chat every five seconds
 * over changes to unrelated sessions; the selected entry keeps its identity
 * across a refetch that did not touch it, so the transcript stays put.
 */
export function useSessionSummary(id: string | null) {
  const { api } = useNativeRuntime();

  const select = useCallback(
    (sessions: ManagedSessionSummary[]) =>
      sessions.find((item) => item.summary.session_id === id) ?? null,
    [id],
  );
  return useQuery<ManagedSessionSummary[], Error, ManagedSessionSummary | null>({
    queryKey: queryKeys.sessions(false),
    queryFn: ({ signal }) => api.listSessions({}, signal),
    refetchInterval: SESSIONS_POLL_MS,
    staleTime: 0,
    placeholderData: keepPreviousData,
    select,
  });
}

function previousDataFrom(sessionId: string) {
  return <T>(previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[1] === sessionId ? previous : undefined;
}

export function useSessionSnapshot(
  id: string | null,
  options?: Partial<UseQueryOptions<SessionSnapshotResponse>>,
) {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useQuery<SessionSnapshotResponse>({
    queryKey: queryKeys.sessionSnapshot(id ?? ""),
    queryFn: async ({ signal }) => {
      const token = beginSnapshotFetch(sessionRefreshKey(client, id!));
      const incoming = await api.getSession(id!, {
        messageLimit: SNAPSHOT_MESSAGE_LIMIT,
        threadEventLimit: SNAPSHOT_THREAD_EVENT_LIMIT,
        includeSessions: false,
        includeSystem: true,
        signal,
      });
      if (!validSnapshotWindow(incoming)) {
        throw new Error("The server returned an invalid snapshot message page.");
      }
      if (
        signal.aborted ||
        !isCurrentSessionGeneration(sessionRefreshKey(client, id!), token.generation)
      ) {
        throw new DOMException("Snapshot superseded", "AbortError");
      }
      finishSnapshotFetch(sessionRefreshKey(client, id!), token);
      return mergeFocusedSnapshot(
        client.getQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id!)),
        incoming,
        token.replace,
      );
    },
    enabled: Boolean(id),
    // The stream invalidates this query, so a stale time only guards bursts.
    staleTime: 1000,
    // Same session: keep the open snapshot on screen while a refetch runs.
    // A different session must not inherit this one's files and transcript.
    placeholderData: previousDataFrom(id ?? ""),
    ...options,
  });
}
export function useLoadOlderMessages(id: string) {
  const { api } = useNativeRuntime();

  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<boolean> => {
      const current = client.getQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id));
      const start = current?.message_page?.start;
      if (start === undefined || start <= 0) {
        throw new Error("No older messages are available.");
      }
      const refreshKey = sessionRefreshKey(client, id);
      const token = beginHistoryFetch(refreshKey);
      try {
        const page = await api.getMessages(id, {
          before: start,
          limit: SNAPSHOT_MESSAGE_LIMIT,
          includeSystem: true,
          signal: token.controller.signal,
        });
        if (!validMessagesPage(page)) {
          throw new Error("The server returned an invalid message page.");
        }
        if (!isCurrentSessionGeneration(refreshKey, token.generation)) return false;

        let accepted = false;
        client.setQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id), (latest) => {
          if (!latest) return latest;
          const merged = prependMessagePage(latest, page, start);
          if (!merged) return latest;
          accepted = true;
          return merged;
        });
        return accepted;
      } catch (error) {
        if (token.controller.signal.aborted) return false;
        throw error;
      } finally {
        finishHistoryFetch(refreshKey, token);
      }
    },
  });
}
export function useThreadEventPages(id: string | null, threadName: string | null) {
  const { api } = useNativeRuntime();

  return useInfiniteQuery<
    ThreadEventPage,
    Error,
    InfiniteData<ThreadEventPage, number | null>,
    ReturnType<typeof queryKeys.threadEvents>,
    number | null
  >({
    queryKey: queryKeys.threadEvents(id ?? "", threadName ?? ""),
    queryFn: ({ pageParam, signal }) =>
      api.getThreadEvents(id!, threadName!, {
        beforeId: pageParam ?? undefined,
        limit: SNAPSHOT_THREAD_EVENT_LIMIT,
        signal,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => (lastPage.has_older ? lastPage.next_before_id : undefined),
    enabled: Boolean(id && threadName),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSessionConfig(id: string | null) {
  const { api } = useNativeRuntime();

  return useQuery<RawSessionConfig>({
    queryKey: queryKeys.sessionConfig(id ?? ""),
    queryFn: ({ signal }) => api.getConfig(id!, signal),
    enabled: Boolean(id),
  });
}

export function useCreateSession() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (payload: CreateSessionRequest) =>
      runCommand(
        createChat({
          create: () => api.createSession(payload),
          accept: (snapshot) => {
            const id = snapshot.metadata.session_id;
            if (!id) throw new Error("The server returned a chat without an identity.");
            fenceSessionSnapshot(sessionRefreshKey(client, id), true);
            client.setQueryData(queryKeys.sessionSnapshot(id), snapshot);
            void invalidate.sessions();
          },
        }),
      ),
  });
}

/**
 * Session ids whose cached snapshot still shows `forkId` as a conversation
 * fork. The open transcript is usually one of these; a background source tab
 * has the same marker and would otherwise stay clickable after the fork is
 * gone.
 */
function sessionIdsShowingFork(client: QueryClient, forkId: string): string[] {
  const ids: string[] = [];
  for (const query of client.getQueryCache().findAll({ queryKey: ["session"] })) {
    const key = query.queryKey;
    if (key[0] !== "session" || key[2] !== "snapshot" || typeof key[1] !== "string") {
      continue;
    }
    const sessionId = key[1];
    if (sessionId === forkId) continue;
    const snapshot = query.state.data as SessionSnapshotResponse | undefined;
    if (!snapshot?.forks?.some((fork) => fork.session_id === forkId)) continue;
    ids.push(sessionId);
  }
  return ids;
}

export function useDeleteSession() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: (_data, id) => {
      void invalidate.sessions();
      client.removeQueries({ queryKey: queryKeys.sessionRoot(id) });
      for (const sourceId of sessionIdsShowingFork(client, id)) {
        void invalidate.sessionRoot(sourceId);
      }
    },
  });
}

export interface RenameSessionVariables {
  id: string;
  /** Empty string restores the automatic title (the last prompt). */
  title: string;
  pinned: boolean;
  expectedVersion: number;
}

export function useUpdatePresentation() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    retry: false,
    mutationFn: ({ id, title, pinned, expectedVersion }: RenameSessionVariables) =>
      api.updatePresentation(id, {
        title,
        pinned,
        expected_version: expectedVersion,
      }),
    onSuccess: () => invalidate.sessions(),
  });
}

/** Pin toggle is a presentation update that keeps the current title. */
export function useTogglePin() {
  const update = useUpdatePresentation();
  return {
    ...update,
    toggle: (summary: SessionSummarySnapshot) =>
      update.mutateAsync({
        id: summary.session_id,
        title: summary.title ?? "",
        pinned: !summary.pinned,
        expectedVersion: summary.presentation_version ?? 0,
      }),
  };
}

export interface MoveSessionOrderVariables {
  /** Full unfiltered list — `/sessions/order` requires entire pin-group membership. */
  sessions: ManagedSessionSummary[];
  sessionId: string;
  targetPinned: boolean;
  /** Index within the destination pin group after the move. */
  targetIndex: number;
}

/**
 * Reorder within a pin group, optionally pinning/unpinning first when the
 * destination group differs. One invalidation at the end.
 */
export function useMoveSessionOrder() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: async ({
      sessions,
      sessionId,
      targetPinned,
      targetIndex,
    }: MoveSessionOrderVariables) => {
      let entries = sessions;
      const entry = entries.find((e) => e.summary.session_id === sessionId);
      if (!entry) {
        throw new Error(`Session '${sessionId}' was not found`);
      }

      if (Boolean(entry.summary.pinned) !== targetPinned) {
        const summary = await api.updatePresentation(sessionId, {
          title: entry.summary.title ?? "",
          pinned: targetPinned,
          expected_version: entry.summary.presentation_version ?? 0,
        });
        entries = withUpdatedSummary(entries, summary);
      }

      const group = pinGroup(entries, targetPinned);
      const currentIds = group.map((e) => e.summary.session_id);
      const nextIds = placeIdAt(currentIds, sessionId, targetIndex);
      if (sameOrder(currentIds, nextIds)) return null;

      return api.reorderSessions(reorderRequest(targetPinned, nextIds, group));
    },
    onSuccess: () => invalidate.sessions(),
  });
}

export function useUpdateConfig() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConfigRequest }) =>
      api.updateConfig(id, patch),
    onSuccess: (_data, { id }) => {
      void client.invalidateQueries({ queryKey: queryKeys.sessionConfig(id) });
      void invalidate.session(id);
      void invalidate.sessions();
    },
  });
}

export function useSubmitRun() {
  const { api } = useNativeRuntime();
  const { captureRuntimeActivation, setOptimisticUserPrompt } =
    useNativeRuntime().stores.runtimeStore;

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, prompt, signal }: { id: string; prompt: string; signal?: AbortSignal }) => {
      const current = captureRuntimeActivation(id);
      return runCommand(
        submitPrompt({
          optimistic: () => {
            if (current()) setOptimisticUserPrompt(prompt);
          },
          admit: async () => {
            const admission = await (signal
              ? api.submitRun(id, prompt, signal)
              : api.submitRun(id, prompt));
            if (admission.status === "accepted")
              return { kind: "accepted", value: admission.response };
            if (admission.status === "not-sent")
              return {
                kind: "not-sent",
                error: new DOMException(
                  "Prompt submission was cancelled before it was sent.",
                  "AbortError",
                ),
              };
            return {
              kind: "uncertain",
              error: new UncertainCommandAdmissionError(admission.requestId, admission.error),
            };
          },
          rejected: () => {
            if (current()) setOptimisticUserPrompt(null);
          },
          reconcile: (replace) => {
            if (replace) {
              fenceSessionSnapshot(sessionRefreshKey(client, id), true);
              void invalidate.sessionRoot(id);
            } else void invalidate.session(id);
          },
        }),
      );
    },
  });
}

export function useSteerOrchestrator() {
  const { api } = useNativeRuntime();

  return useMutation({
    mutationFn: ({ id, instruction }: { id: string; instruction: string }) =>
      api.steerOrchestrator(id, instruction),
  });
}

export function useSteerThread() {
  const { api } = useNativeRuntime();

  return useMutation({
    mutationFn: ({
      id,
      threadName,
      instruction,
    }: {
      id: string;
      threadName: string;
      instruction: string;
    }) => api.steerThread(id, threadName, instruction),
  });
}

export function useCancelRun() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) => runCommand(stopRun(makeStopPorts(client, id))),
  });
}

export function useCompactSession() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.compactSession(id),
    onSuccess: (_data, id) => {
      fenceSessionSnapshot(sessionRefreshKey(client, id), true);
      return invalidate.sessionRoot(id);
    },
  });
}

/**
 * A revert rewrites the transcript and the checkout at once. Invalidating the
 * session root drops the snapshot, thread history, file data, and revision
 * views that the reverted state invalidated.
 */
export function useRevertSession() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, messageIdx }: { id: string; messageIdx: number }) =>
      api.revertSession(id, messageIdx),
    onSuccess: (_data, { id }) => {
      fenceSessionSnapshot(sessionRefreshKey(client, id), true);
      void invalidate.sessionRoot(id);
      void invalidate.sessions();
    },
  });
}

/**
 * Answering a prompt again is a revert plus a run, so it drops the same views a
 * revert does before the new run starts filling them back in.
 */
export function useRegenerateRun() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, messageIdx }: { id: string; messageIdx: number }) =>
      api.regenerateRun(id, messageIdx),
    onSuccess: (_data, { id }) => {
      fenceSessionSnapshot(sessionRefreshKey(client, id), true);
      void invalidate.sessionRoot(id);
      void invalidate.sessions();
    },
  });
}

/**
 * Clone the transcript through a finished model turn into a new session, then
 * open that chat. The source snapshot has to refetch so the fork marker lands
 * under the turn that was copied.
 */
export function useForkSession() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ id, messageIdx }: { id: string; messageIdx: number }) =>
      api.forkSession(id, messageIdx),
    onSuccess: (_data, { id }) => {
      void invalidate.sessionRoot(id);
      void invalidate.sessions();
    },
  });
}

export function useDismissSessionFork() {
  const { api } = useNativeRuntime();

  const invalidate = useQueryInvalidators();
  return useMutation({
    mutationFn: ({ id, forkId }: { id: string; forkId: string }) =>
      api.dismissSessionFork(id, forkId),
    onSuccess: (_data, { id }) => {
      void invalidate.sessionRoot(id);
    },
  });
}

export function useVisibleSessions() {
  const query = useSessions();
  const policy = useUiPolicy();
  const data = useMemo(
    () => (query.data ? visibleSessions(policy, query.data) : undefined),
    [query.data, policy],
  );
  return { ...query, data };
}
