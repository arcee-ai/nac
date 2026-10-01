import { Cause, Duration, Effect, Option } from "effect";
import { Atom } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { Layer } from "effect";

import { ClientRequestError } from "@/app/effect/errors";
import { NacTransport } from "@/app/effect/runtime";
import { nacClient } from "@/app/services/nacClient";

/**
 * Effect runtime for server atoms. Programs ask it for `NacTransport`; React
 * only subscribes through the registry that mounts the atom.
 */
export const nacAtoms = Atom.runtime(Layer.succeed(NacTransport, nacClient));

export type Remote<A, E = ClientRequestError> = Atom.Writable<
  AsyncResult.AsyncResult<A, E>,
  AsyncResult.AsyncResult<A, E>
>;

interface RemoteOptions<A> {
  /** Skip a mount fetch while the last success is younger than this. Infinity stays fresh. */
  staleMs?: number;
  /** Repeat while the atom is mounted. A function reads the latest success. */
  pollMs?: number | ((value: A | undefined) => number | false);
  pollInBackground?: boolean;
  /** Extra attempts after the first failure. Commands do not use this. */
  retry?: number | false;
  /** `"always"` refetches on every mount, including a fresh success. */
  refreshOnMount?: boolean | "always";
  /**
   * Remember the last success for this group so a new key in the same session
   * can stay on screen until its own read lands.
   */
  stickyGroup?: string;
}

interface Handle {
  readonly id: string;
  readonly atom: Remote<unknown, unknown>;
  readonly state: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>;
  readonly loader: Atom.Atom<AsyncResult.AsyncResult<void, unknown>>;
  readonly busy: Atom.Atom<boolean>;
}

const handles = new Map<string, Handle>();
const catalog = Atom.keepAlive(Atom.make<readonly string[]>([]));
const sticky = Atom.family((group: string) => {
  void group;
  return Atom.keepAlive(Atom.make<AsyncResult.AsyncResult<unknown, unknown> | null>(null));
});

const idleRemote = Atom.writable(
  (): AsyncResult.AsyncResult<never, never> => AsyncResult.initial(false),
  () => undefined,
);

/** Stable atom for a query that must not hit the network. */
export function idleAtom<A, E = ClientRequestError>(): Remote<A, E> {
  return idleRemote as Remote<A, E>;
}

function remember(get: Atom.AtomContext, id: string): void {
  const current = get.once(catalog);
  if (!current.includes(id)) get.set(catalog, [...current, id]);
}

function pollDelay<A>(pollMs: RemoteOptions<A>["pollMs"], value: A | undefined): number | false {
  if (pollMs === undefined) return false;
  const resolved = typeof pollMs === "function" ? pollMs(value) : pollMs;
  if (resolved === false || resolved <= 0) return false;
  return resolved;
}

function hidden(pollInBackground: boolean | undefined): boolean {
  const paused =
    !pollInBackground && typeof document !== "undefined" && document.visibilityState === "hidden";
  return paused;
}

/**
 * One writable `AsyncResult` atom backed by an Effect program.
 * Mounting it runs the program; `registry.set` replaces the value for SSE patches.
 */
export function remoteAtom<A, E = ClientRequestError>(
  id: string,
  load: (get: Atom.AtomContext, current: A | undefined) => Effect.Effect<A, E, NacTransport>,
  options: RemoteOptions<A> = {},
): Remote<A, E> {
  const staleMs = options.staleMs ?? 30_000;
  const retry = options.retry === undefined ? 1 : options.retry;
  // Kept alive so an in-flight refresh cannot observe the counter reset to 0
  // and treat that as another refresh.
  const revision = Atom.keepAlive(Atom.make(0));
  const busy = Atom.make(false);
  const state = Atom.keepAlive(Atom.make<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial(true)));
  const loader = nacAtoms.atom((get) =>
    Effect.gen(function* () {
      remember(get, id);
      const attempts = retry === false ? 1 : retry + 1;
      let first = true;
      while (true) {
        const current = get.once(state);
        const fresh =
          first &&
          AsyncResult.isSuccess(current) &&
          !current.waiting &&
          options.refreshOnMount !== "always" &&
          Number.isFinite(staleMs) &&
          Date.now() - current.timestamp < staleMs;
        first = false;
        if (!fresh) {
          if (AsyncResult.isSuccess(current) && !current.waiting) {
            get.set(
              state,
              AsyncResult.success(current.value, { waiting: true, timestamp: current.timestamp }),
            );
          }
          const ticket = get.once(revision);
          get.set(busy, true);
          let error: unknown = null;
          let loaded: A | undefined;
          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const exit = yield* Effect.exit(load(get, valueOf(get.once(state))));
            if (exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause)) {
              get.set(busy, false);
              return;
            }
            if (get.once(revision) !== ticket) {
              get.set(busy, false);
              break;
            }
            if (exit._tag === "Success") {
              loaded = exit.value;
              error = null;
              break;
            }
            error = Cause.squash(exit.cause);
            const aborted =
              typeof DOMException !== "undefined" &&
              error instanceof DOMException &&
              error.name === "AbortError";
            if (aborted) {
              get.set(busy, false);
              return;
            }
            if (attempt === attempts) break;
          }
          get.set(busy, false);
          if (get.once(revision) === ticket) {
            if (error == null && loaded !== undefined) {
              const success = AsyncResult.success<A, E>(loaded);
              get.set(state, success);
              if (options.stickyGroup) get.set(sticky(options.stickyGroup), success);
            } else if (error != null) {
              const latest = get.once(state);
              const previous = AsyncResult.isSuccess(latest) ? Option.some(latest) : Option.none();
              get.set(state, AsyncResult.fail(error as E, { previousSuccess: previous }));
            }
          }
          if (get.once(revision) !== ticket) {
            const latest = get.once(state);
            const refreshRequested =
              (AsyncResult.isSuccess(latest) && latest.waiting && latest.timestamp === 0) ||
              (AsyncResult.isInitial(latest) && latest.waiting);
            if (refreshRequested) continue;
          }
        }
        const delay = pollDelay(options.pollMs, valueOf(get.once(state)));
        if (delay === false) break;
        do {
          yield* Effect.sleep(Duration.millis(hidden(options.pollInBackground) ? 1000 : delay));
        } while (hidden(options.pollInBackground));
      }
    }),
  );

  const atom: Remote<A, E> = Atom.writable(
    (get): AsyncResult.AsyncResult<A, E> => {
      get(loader);
      const current = get(state);
      if (!AsyncResult.isInitial(current) || !options.stickyGroup) return current;
      const previous = get(sticky(options.stickyGroup));
      if (previous && AsyncResult.isSuccess(previous)) {
        return AsyncResult.success(previous.value as A, { waiting: true });
      }
      return current;
    },
    (ctx, value: AsyncResult.AsyncResult<A, E>) => {
      ctx.set(revision, ctx.get(revision) + 1);
      ctx.set(state, value);
    },
    (refresh) => {
      refresh(loader);
    },
  );
  handles.set(id, {
    id,
    atom: atom as Remote<unknown, unknown>,
    state: state as Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>,
    loader: loader as Atom.Atom<AsyncResult.AsyncResult<void, unknown>>,
    busy,
  });
  return atom;
}

export function valueOf<A>(result: AsyncResult.AsyncResult<A, unknown>): A | undefined {
  if (AsyncResult.isSuccess(result)) return result.value;
  if (AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)) {
    return result.previousSuccess.value.value;
  }
  return undefined;
}

export function failureReason(result: AsyncResult.AsyncResult<unknown, unknown>): unknown {
  if (!AsyncResult.isFailure(result)) return null;
  const reason = Cause.squash(result.cause);
  return reason instanceof ClientRequestError ? reason.error : reason;
}

/** What a component reads off an atom: the value, and whether a read is still running. */
export interface AsyncView<A> {
  data: A | undefined;
  error: unknown;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
}

export function readAsync<A>(result: AsyncResult.AsyncResult<A, unknown>): AsyncView<A> {
  const data = valueOf(result);
  const isSuccess = AsyncResult.isSuccess(result);
  const isError = AsyncResult.isFailure(result);
  const isPending = !isSuccess && !isError;
  return {
    data,
    error: failureReason(result),
    isPending,
    isLoading: isPending && result.waiting,
    isFetching: result.waiting,
    isSuccess,
    isError,
  };
}

function matches(id: string, prefix: string): boolean {
  return id === prefix || id.startsWith(`${prefix}\0`);
}

export function prefixedIds(
  registry: AtomRegistry.AtomRegistry,
  prefix: string,
): readonly string[] {
  return registry.get(catalog).filter((id) => matches(id, prefix));
}

/** Read a cached atom without mounting its loader. */
export function peekById(
  registry: AtomRegistry.AtomRegistry,
  id: string,
): AsyncResult.AsyncResult<unknown, unknown> | undefined {
  const handle = handles.get(id);
  if (!handle) return undefined;
  return registry.get(handle.state);
}

/** Drop cached values. An in-flight program sees the revision move and does not write back. */
export function resetPrefixed(registry: AtomRegistry.AtomRegistry, prefix: string): void {
  for (const handle of handles.values()) {
    if (!matches(handle.id, prefix)) continue;
    registry.set(handle.atom, AsyncResult.initial(false));
  }
}

/** Mark matching mounted atoms stale and run their programs again. */
export function refreshPrefixed(
  registry: AtomRegistry.AtomRegistry,
  prefix: string,
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const handle of handles.values()) {
    if (!matches(handle.id, prefix)) continue;
    pending.push(refreshRemote(registry, handle.atom));
  }
  return Promise.all(pending).then(() => undefined);
}

/**
 * Refetch one atom. Stream hooks await this; tests replace it when they need
 * to hold a snapshot reload open.
 */
export const atomRefresh = {
  run<A, E>(registry: AtomRegistry.AtomRegistry, atom: Remote<A, E>): Promise<void> {
    return refreshRemote(registry, atom as Remote<unknown, unknown>);
  },
};

function atomIsObserved(
  registry: AtomRegistry.AtomRegistry,
  atom: Remote<unknown, unknown>,
): boolean {
  const node = registry.getNodes().get(atom);
  if (!node) return false;
  return node.listeners.size > 0 || node.children.size > 0;
}

function refreshRemote(
  registry: AtomRegistry.AtomRegistry,
  atom: Remote<unknown, unknown>,
): Promise<void> {
  const handle = [...handles.values()].find((entry) => entry.atom === atom);
  if (!handle) return Promise.resolve();
  // An unmounted atom has nothing to rerun its loader. Mark it stale for the
  // next subscriber and resolve; waiting here would stall the command.
  const live = atomIsObserved(registry, atom);
  registry.update(atom, (current) => {
    if (AsyncResult.isSuccess(current)) {
      return AsyncResult.success(current.value, { waiting: true, timestamp: 0 });
    }
    return AsyncResult.initial(true);
  });
  if (!live) return Promise.resolve();
  registry.refresh(atom);
  const settled = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
    !AsyncResult.isInitial(result) && !result.waiting;
  return new Promise((resolve) => {
    const unsubscribe = registry.subscribe(
      handle.state,
      (result) => {
        if (!settled(result)) return;
        unsubscribe();
        resolve();
      },
      { immediate: true },
    );
  });
}

/** Replace the success value. An updater that returns undefined leaves the atom alone. */
export function patchRemote<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Remote<A, E>,
  update: (current: A | undefined) => A | undefined,
): void {
  registry.update(atom, (current) => {
    const next = update(valueOf(current));
    if (next === undefined) return current;
    return AsyncResult.success(next);
  });
}

/** How many matching atoms are waiting on the network. */
export const inFlight = Atom.family((prefix: string) =>
  Atom.make((get): number => {
    let count = 0;
    for (const id of get(catalog)) {
      if (!matches(id, prefix)) continue;
      const handle = handles.get(id);
      if (handle && get(handle.busy)) count += 1;
    }
    return count;
  }),
);

export function isolatedRegistry(): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    // Defer so a new node can gain its listener before idle removal runs.
    // A synchronous scheduler deletes the node inside `createNode`.
    scheduleTask: (run) => {
      queueMicrotask(run);
      return () => {};
    },
  });
}
