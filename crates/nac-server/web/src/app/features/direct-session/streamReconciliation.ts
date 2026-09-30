import { Context, Effect, Scope } from "effect";

/** Canonical consequences of a delivered event, projected by the browser adapter. */
export interface SessionChange {
  refresh: "none" | "messages" | "snapshot" | "replace-snapshot";
  transcriptLength: number;
  finishedThread?: string;
  runCompleted: boolean;
  permissionsChanged: boolean;
}

/** Application-owned observation capabilities; cache and wire types stay at the edge. */
export interface ObservationPorts {
  attach: () => void;
  detach: () => void;
  subscribe: (callbacks: {
    change: (change: SessionChange) => void;
    epoch: (epoch: string) => void;
    replayLost: () => void;
  }) => () => void;
  fenceSnapshot: (replace: boolean) => void;
  snapshot: () => Promise<void>;
  tail: (
    signal: AbortSignal,
  ) => Promise<
    { kind: "accepted"; total: number } | { kind: "obsolete" } | { kind: "snapshot-required" }
  >;
  invalidate: (kind: "permissions" | "skills" | "revisions" | "thread", thread?: string) => void;
}

/** The composition root supplies the existing browser capabilities for one activation. */
export class SessionObservation extends Context.Tag("nac/SessionObservation")<
  SessionObservation,
  ObservationPorts
>() {}

/** A scoped observation lease. Closing it never cancels a durable run. */
export interface ObservationLease {
  close: () => void;
}

const RELOAD_DEBOUNCE_MS = 250;

/**
 * Own burst coalescing, snapshot priority, replay recovery, and read/resource release.
 * The typed client still owns ordered delivery/reconnect; TanStack owns the cache.
 */
export const observeSession: Effect.Effect<
  ObservationLease,
  never,
  SessionObservation | Scope.Scope
> = Effect.gen(function* () {
  const ports = yield* SessionObservation;
  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      ports.attach();
      let disposed = false;
      let tailTimer: ReturnType<typeof setTimeout> | null = null;
      let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
      let tailRunning = false;
      let snapshotRunning = false;
      let tailDirty = false;
      let highestTranscriptLength = 0;
      let snapshotRequest = 0;
      let epochId: string | null = null;
      const reads = new AbortController();

      function scheduleSnapshot(replace: boolean) {
        if (disposed) return;
        if (replace) highestTranscriptLength = 0;
        ports.fenceSnapshot(replace);
        clearTimeout(tailTimer ?? undefined);
        tailTimer = null;
        tailDirty = false;
        clearTimeout(snapshotTimer ?? undefined);
        snapshotTimer = setTimeout(() => {
          snapshotTimer = null;
          if (disposed) return;
          const requestId = ++snapshotRequest;
          snapshotRunning = true;
          void Effect.runPromise(
            Effect.tryPromise({
              try: ports.snapshot,
              catch: () => "snapshot-unavailable" as const,
            }).pipe(
              Effect.ignore,
              Effect.ensuring(
                Effect.sync(() => {
                  if (disposed || requestId !== snapshotRequest) return;
                  snapshotRunning = false;
                  if (tailDirty && snapshotTimer === null) drainTail();
                }),
              ),
            ),
          );
        }, RELOAD_DEBOUNCE_MS);
      }

      function drainTail() {
        if (disposed || tailRunning || snapshotRunning || snapshotTimer !== null) return;
        tailRunning = true;
        const drain = Effect.gen(function* () {
          let followUpsRemaining = 1;
          while (!disposed && tailDirty && !snapshotRunning && snapshotTimer === null) {
            tailDirty = false;
            const result = yield* Effect.tryPromise({
              try: () => ports.tail(reads.signal),
              catch: () => "tail-unavailable" as const,
            }).pipe(Effect.catchAll(() => Effect.succeed({ kind: "snapshot-required" as const })));
            if (disposed || result.kind === "obsolete") continue;
            if (result.kind === "snapshot-required") {
              scheduleSnapshot(true);
              return;
            }
            if (result.total < highestTranscriptLength) {
              if (followUpsRemaining === 0) {
                scheduleSnapshot(false);
                return;
              }
              followUpsRemaining -= 1;
              tailDirty = true;
            }
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tailRunning = false;
            }),
          ),
        );
        void Effect.runPromise(drain);
      }

      function scheduleTail(length: number) {
        if (disposed) return;
        highestTranscriptLength = Math.max(highestTranscriptLength, length);
        tailDirty = true;
        if (snapshotTimer !== null || snapshotRunning || tailRunning) return;
        clearTimeout(tailTimer ?? undefined);
        tailTimer = setTimeout(() => {
          tailTimer = null;
          drainTail();
        }, RELOAD_DEBOUNCE_MS);
      }

      const replayLost = () => {
        if (disposed) return;
        scheduleSnapshot(true);
        ports.invalidate("permissions");
      };
      const unsubscribe = ports.subscribe({
        change: (change) => {
          if (disposed) return;
          if (change.finishedThread) ports.invalidate("thread", change.finishedThread);
          if (change.refresh === "messages") scheduleTail(change.transcriptLength);
          else if (change.refresh === "snapshot") scheduleSnapshot(false);
          else if (change.refresh === "replace-snapshot") scheduleSnapshot(true);
          if (change.runCompleted) ports.invalidate("revisions");
          if (change.permissionsChanged) ports.invalidate("permissions");
        },
        epoch: (epoch) => {
          if (disposed) return;
          if (epochId !== null && epoch !== epochId) {
            scheduleSnapshot(true);
            ports.invalidate("skills");
            ports.invalidate("permissions");
          }
          epochId = epoch;
        },
        replayLost,
      });
      return {
        close: () => {
          if (disposed) return;
          disposed = true;
          snapshotRequest += 1;
          unsubscribe();
          clearTimeout(tailTimer ?? undefined);
          clearTimeout(snapshotTimer ?? undefined);
          reads.abort();
          ports.detach();
        },
      };
    }),
    (lease) => Effect.sync(lease.close),
  );
});
