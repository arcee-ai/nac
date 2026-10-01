import { Cause, Data, Effect, Exit, Option } from "effect";

export type SetupPhase =
  | "read"
  | "preset"
  | "project"
  | "chat"
  | "configuration"
  | "title"
  | "default";
export type FailureKind = "rejected" | "conflict" | "unknown" | "cancelled";

/** Completed stages are durable facts, not a transaction to roll back or replay. */
export class SetupFailure extends Data.TaggedError("SetupFailure")<{
  phase: SetupPhase;
  kind: FailureKind;
  cause: unknown;
  completed: readonly SetupPhase[];
}> {}

export function requiresSetupReview(error: unknown): error is SetupFailure {
  return (
    error instanceof SetupFailure &&
    (error.kind === "unknown" || error.kind === "conflict" || error.completed.length > 0)
  );
}

export interface SetupPorts {
  current: () => boolean;
  classify: (cause: unknown, phase: SetupPhase) => FailureKind;
  /** Reconcile the origin even if the initiating presentation has gone away. */
  reconcile: (phase: SetupPhase) => Promise<unknown>;
}

/** One command sequence: no retries, and no new writes after presentation detaches. */
export function setupSequence<T>(
  ports: SetupPorts,
  body: (
    step: <A>(
      phase: SetupPhase,
      operation: () => Promise<A>,
      writes?: boolean,
    ) => Effect.Effect<A, SetupFailure>,
  ) => Effect.Effect<T, SetupFailure>,
): Effect.Effect<T, SetupFailure> {
  return Effect.suspend(() => {
    const completed: SetupPhase[] = [];
    const step = <A>(phase: SetupPhase, operation: () => Promise<A>, writes = true) =>
      Effect.gen(function* () {
        if (!ports.current()) {
          return yield* Effect.fail(
            new SetupFailure({ phase, kind: "cancelled", cause: null, completed: [...completed] }),
          );
        }
        const result = yield* Effect.tryPromise({
          try: operation,
          catch: (cause) => {
            const kind = ports.classify(cause, phase);
            return new SetupFailure({
              phase,
              kind: phase === "read" && kind === "unknown" ? "rejected" : kind,
              cause,
              completed: [...completed],
            });
          },
        }).pipe(
          Effect.tapError(() =>
            writes ? Effect.promise(() => ports.reconcile(phase)) : Effect.void,
          ),
        );
        if (writes) {
          completed.push(phase);
          yield* Effect.promise(() => ports.reconcile(phase));
        }
        return result;
      });
    return body(step);
  });
}

export function createProjectChat<M, P, C>(
  ports: SetupPorts & {
    persistsModel?: boolean;
    model: () => Promise<M>;
    project: (model: M) => Promise<P>;
    chat: (model: M, project: P) => Promise<C>;
  },
) {
  return setupSequence(ports, (step) =>
    Effect.gen(function* () {
      const model = yield* step("preset", ports.model, ports.persistsModel ?? true);
      const project = yield* step("project", () => ports.project(model));
      const chat = yield* step("chat", () => ports.chat(model, project));
      return { model, project, chat };
    }),
  );
}

export function createConfiguredChat<M, C>(
  ports: SetupPorts & {
    existing?: () => Promise<C | null>;
    persistsModel?: boolean;
    model: () => Promise<M>;
    chat: (model: M) => Promise<C>;
  },
) {
  return setupSequence(ports, (step) =>
    Effect.gen(function* () {
      if (ports.existing) {
        const existing = yield* step("read", ports.existing, false);
        if (existing !== null) return existing;
      }
      const model = yield* step("preset", ports.model, ports.persistsModel ?? true);
      return yield* step("chat", () => ports.chat(model));
    }),
  );
}

/** Title and config remain separate writes; a partial save remains visible. */
export function saveSettings<M>(
  ports: SetupPorts & {
    check: () => Promise<unknown>;
    persistsModel?: boolean;
    model: () => Promise<M>;
    configurationSaved?: boolean;
    configuration: (model: M) => Promise<unknown>;
    title?: () => Promise<unknown>;
    projectDefault?: (model: M) => Promise<unknown>;
  },
) {
  return setupSequence(ports, (step) =>
    Effect.gen(function* () {
      yield* step("read", ports.check, false);
      const model = yield* step("preset", ports.model, ports.persistsModel ?? true);
      yield* step(
        "configuration",
        () => ports.configuration(model),
        ports.configurationSaved ?? true,
      );
      if (ports.title) yield* step("title", ports.title);
      if (ports.projectDefault) yield* step("default", () => ports.projectDefault!(model));
      return model;
    }),
  );
}

export async function runSetup<T>(workflow: Effect.Effect<T, SetupFailure>): Promise<T> {
  const result = await Effect.runPromiseExit(workflow);
  if (Exit.isSuccess(result)) return result.value;
  const failure = Cause.failureOption(result.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw Cause.squash(result.cause);
}
