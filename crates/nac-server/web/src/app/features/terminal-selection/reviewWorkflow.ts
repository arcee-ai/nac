import { Data, Effect, Exit, Scope } from "effect";

/** Expected transport failures are local preview failure or unconfirmed admission. */
export class SelectionFailure extends Data.TaggedError("SelectionFailure")<{
  operation: "preview" | "submit";
  cause: unknown;
}> {}

/** One operation owns its read/request signal; closing never cancels durable work. */
export function openSelectionOperation(activationCurrent: () => boolean) {
  const scope = Effect.runSync(Scope.make());
  const controller = new AbortController();
  let active = true;
  Effect.runSync(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        active = false;
        controller.abort();
      }),
    ),
  );
  return {
    signal: controller.signal,
    activationCurrent,
    current: () => active && activationCurrent(),
    close: () => Effect.runSync(Scope.close(scope, Exit.void)),
  };
}
export type SelectionOperation = ReturnType<typeof openSelectionOperation>;

interface OperationPorts<T> {
  readonly operation: SelectionOperation;
  readonly started: () => void;
  readonly request: (signal: AbortSignal) => Promise<T>;
  readonly confirmed: (value: T) => void;
  readonly failed: (failure: SelectionFailure) => void;
}

/** Preview once and publish only through the operation's presentation fence. */
export function previewSelection<T>(ports: OperationPorts<T>): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.sync(ports.started);
    yield* Effect.tryPromise({
      try: () => ports.request(ports.operation.signal),
      catch: (cause) => new SelectionFailure({ operation: "preview", cause }),
    }).pipe(
      Effect.matchEffect({
        onSuccess: (value) => Effect.sync(() => ports.confirmed(value)),
        onFailure: (failure) => Effect.sync(() => ports.failed(failure)),
      }),
    );
  }).pipe(Effect.ensuring(Effect.sync(ports.operation.close)));
}

/**
 * Submit once, settle the originating cache before applying a fenced receipt.
 * The request may settle after disposal; abort/detach never authorizes replay.
 * Only the caller's explicit retry can reuse the immutable admission identity.
 */
export function submitSelection<T>(
  ports: OperationPorts<T> & { readonly accepted: () => void; readonly unconfirmed: () => void },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.sync(ports.started);
    yield* Effect.tryPromise({
      try: () => ports.request(ports.operation.signal),
      catch: (cause) => new SelectionFailure({ operation: "submit", cause }),
    }).pipe(
      Effect.matchEffect({
        onSuccess: (value) =>
          Effect.gen(function* () {
            yield* Effect.sync(ports.accepted);
            yield* Effect.sync(() => ports.confirmed(value));
          }),
        onFailure: (failure) =>
          Effect.gen(function* () {
            yield* Effect.sync(ports.unconfirmed);
            yield* Effect.sync(() => ports.failed(failure));
          }),
      }),
    );
  }).pipe(Effect.ensuring(Effect.sync(ports.operation.close)));
}
