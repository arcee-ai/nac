import { Cause, Data, Effect, Exit, Option } from "effect";

/** Expected command failures retain the transport's error for product recovery UI. */
export class CommandFailure extends Data.TaggedError("CommandFailure")<{
  operation: "submit" | "stop" | "create" | "steer" | "queue" | "command";
  cause: unknown;
}> {}

/** Admission comes from the typed client; this workflow never invents or retries it. */
export type PromptAdmission<T> =
  | { kind: "accepted"; value: T }
  | { kind: "not-sent"; error: unknown }
  | { kind: "uncertain"; error: unknown };

/** Origin-bound capabilities keep settlement alive after presentation detaches. */
export interface SubmitPorts<T> {
  optimistic: () => void;
  admit: () => Promise<PromptAdmission<T>>;
  rejected: () => void;
  reconcile: (replace: boolean) => void;
}

/** Admit exactly once, retaining uncertain optimistic input until canonical reconciliation. */
export function submitPrompt<T>(ports: SubmitPorts<T>): Effect.Effect<T, CommandFailure> {
  return Effect.gen(function* () {
    yield* Effect.sync(ports.optimistic);
    const result = yield* Effect.tryPromise({
      try: ports.admit,
      catch: (cause) => new CommandFailure({ operation: "submit", cause }),
    }).pipe(Effect.tapError(() => Effect.sync(ports.rejected)));
    if (result.kind === "accepted") {
      yield* Effect.sync(() => ports.reconcile(false));
      return result.value;
    }
    yield* Effect.sync(() => {
      if (result.kind === "uncertain") ports.reconcile(true);
      else ports.rejected();
    });
    return yield* Effect.fail(new CommandFailure({ operation: "submit", cause: result.error }));
  });
}

/** Stop rollback and settlement belong to the request's origin, never the current view. */
export function stopRun(ports: {
  optimistic: () => void;
  cancel: () => Promise<unknown>;
  rollback: () => void;
  settled: () => void;
}): Effect.Effect<void, CommandFailure> {
  return Effect.gen(function* () {
    yield* Effect.sync(ports.optimistic);
    yield* Effect.tryPromise({
      try: ports.cancel,
      catch: (cause) => new CommandFailure({ operation: "stop", cause }),
    }).pipe(Effect.tapError(() => Effect.sync(ports.rollback)));
    yield* Effect.sync(ports.settled);
  });
}

/** Create once and accept its canonical snapshot before navigation can mount the chat. */
export function createChat<T>(ports: {
  create: () => Promise<T>;
  accept: (created: T) => void;
}): Effect.Effect<T, CommandFailure> {
  return Effect.tryPromise({
    try: ports.create,
    catch: (cause) => new CommandFailure({ operation: "create", cause }),
  }).pipe(Effect.tap((created) => Effect.sync(() => ports.accept(created))));
}

/** Direct input is durable inbox steering/queueing; classic running input remains steering. */
export function deliverPrompt(ports: {
  mode: "idle" | "direct-running" | "classic-running";
  delivery?: "steer" | "queue";
  submit: () => Promise<unknown>;
  inbox: (delivery: "steer" | "queue") => Promise<unknown>;
  steer: () => Promise<unknown>;
}): Effect.Effect<"submitted" | "steered" | "queued", CommandFailure> {
  if (ports.mode === "direct-running" || ports.delivery) {
    const delivery = ports.delivery ?? "steer";
    return Effect.tryPromise({
      try: () => ports.inbox(delivery),
      catch: (cause) => new CommandFailure({ operation: delivery, cause }),
    }).pipe(Effect.as(delivery === "queue" ? ("queued" as const) : ("steered" as const)));
  }
  const steering = ports.mode === "classic-running";
  return Effect.tryPromise({
    try: steering ? ports.steer : ports.submit,
    catch: (cause) => new CommandFailure({ operation: steering ? "steer" : "submit", cause }),
  }).pipe(Effect.as(steering ? ("steered" as const) : ("submitted" as const)));
}

export type UserCommandAdmission<T> =
  | { kind: "accepted"; value: T }
  | { kind: "not-sent"; error: unknown }
  | { kind: "uncertain"; requestId: string; error: unknown };

/** POST once; an uncertain admission is settled by looking up its request id, never by resending. */
export function runUserCommand<T>(ports: {
  admit: () => Promise<UserCommandAdmission<T>>;
  lookup: (requestId: string) => Promise<T>;
}): Effect.Effect<T, CommandFailure> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: ports.admit,
      catch: (cause) => new CommandFailure({ operation: "command", cause }),
    });
    if (result.kind === "accepted") return result.value;
    if (result.kind === "not-sent") {
      return yield* Effect.fail(new CommandFailure({ operation: "command", cause: result.error }));
    }
    const { requestId, error } = result;
    return yield* Effect.tryPromise({
      try: () => ports.lookup(requestId),
      catch: () => new CommandFailure({ operation: "command", cause: error }),
    });
  });
}

/** Unwrap only expected workflow failures; defects retain Effect's diagnostics. */
export async function runCommand<T>(command: Effect.Effect<T, CommandFailure>): Promise<T> {
  const exit = await Effect.runPromiseExit(command);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value.cause;
  throw Cause.squash(exit.cause);
}
