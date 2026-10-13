import { Cause, Data, Effect, Exit, Option, Scope } from "effect";
import {
  UserTerminalConnection,
  UserTerminalInputPump,
  TerminalInputNotSentError,
  TerminalInputRejectedError,
  type UserTerminalApi,
  type ExecutionApi,
  type ExecutionStatus,
  type InputControlStatus,
  type TerminalControlApi,
  createExecutionConnection,
  bindExecutionInput,
} from "../../../../packages/nac-client/src/index";
import { createTerminalRenderer } from "./xtermAdapter";
import { observeHumanTerminalInput } from "./humanInput";

type Adapter = Awaited<ReturnType<typeof createTerminalRenderer>>;
export interface TerminalControls {
  adapter: Adapter;
  pump: UserTerminalInputPump;
  restoreFreshInput: () => boolean;
  hasActiveInput: () => boolean;
  updateInput: (control: TerminalPorts["inputControl"], paused: boolean) => void;
}
interface TerminalPorts {
  api: UserTerminalApi & Partial<ExecutionApi & TerminalControlApi>;
  source?: ExecutionStatus;
  readonly?: boolean;
  inputControl?: Pick<InputControlStatus, "controller" | "revision" | "frozen"> | null;
  inputPaused?: boolean;
  sessionId: string;
  terminalId: string;
  host: HTMLDivElement;
  reconnect: boolean;
  previousFailure: {
    current: boolean;
    readonly available?: boolean;
    subscribe?: (listener: () => void) => () => void;
  };
  controls: (value: TerminalControls | null) => void;
  phase: (value: string) => void;
  notice: (value: string) => void;
  inputFailure: (value: boolean) => void;
}
class TerminalOperationFailure extends Data.TaggedError("TerminalOperationFailure")<{
  operation: "renderer" | "attach" | "observe" | "resize" | "input";
  cause: unknown;
}> {}
function operation<T>(
  name: TerminalOperationFailure["operation"],
  run: () => Promise<T>,
): Effect.Effect<T, TerminalOperationFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new TerminalOperationFailure({ operation: name, cause }),
  });
}
function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

/** One synchronous Scope owns the browser activation; the SDK owns protocol state. */
export function openTerminalObservation(ports: TerminalPorts): () => void {
  const scope = Effect.runSync(Scope.make());
  const abort = new AbortController();
  const active = () => !abort.signal.aborted;
  const own = (release: () => void) => {
    if (!active()) release();
    else Effect.runSync(Scope.addFinalizer(scope, Effect.sync(release)));
  };
  let adapter: Adapter | undefined;
  let connected = false;
  let processAlive = false;
  let inputControl = ports.inputControl;
  let inputPaused = ports.inputPaused ?? false;
  const disconnected = (cause: unknown) => {
    if (!active()) return;
    connected = false;
    ports.phase("Disconnected");
    ports.notice(message(cause, "Terminal observation failed"));
    if (adapter) adapter.terminal.options.disableStdin = true;
  };
  const run = (workflow: Effect.Effect<unknown, TerminalOperationFailure>) => {
    void Effect.runPromiseExit(workflow, { signal: abort.signal })
      .then((exit) => {
        if (Exit.isFailure(exit) && active()) {
          const failure = Cause.failureOption(exit.cause);
          disconnected(Option.isSome(failure) ? failure.value.cause : Cause.squash(exit.cause));
        }
      })
      .catch(disconnected);
  };

  const observe = Effect.gen(function* () {
    adapter = yield* operation("renderer", () =>
      createTerminalRenderer(ports.host).then((created) => {
        // Dynamic import is not cancellable. A late acquisition must release itself.
        own(created.dispose);
        abort.signal.throwIfAborted();
        return created;
      }),
    );
    const view = adapter;
    const connection =
      ports.source &&
      ports.api.attachExecution &&
      ports.api.pullExecution &&
      ports.api.detachExecution &&
      ports.api.stopExecution &&
      ports.api.listExecutions
        ? createExecutionConnection(
            ports.api as UserTerminalApi & ExecutionApi & Partial<TerminalControlApi>,
            ports.sessionId,
            ports.source,
            view.renderer,
            { pageLimit: 32_768, readonly: ports.readonly },
            ports.inputControl,
          )
        : new UserTerminalConnection(ports.api, ports.sessionId, ports.terminalId, view.renderer, {
            pageLimit: 32_768,
          });
    own(() => {
      // Detach is SDK observer cleanup, never shell/agent cancellation.
      void connection.detach().catch(() => {});
    });
    let pump = new UserTerminalInputPump(connection, abort.signal);
    const retired = new Set<UserTerminalInputPump>();
    const hasActiveInput = () =>
      pump.hasActiveInput || [...retired].some((old) => old.hasActiveInput);
    own(() => {
      if (hasActiveInput() || pump.needsAcknowledgement) ports.previousFailure.current = true;
      pump.dispose();
      ports.controls(null);
    });
    const restoreFreshInput = () => {
      const enabled =
        active() &&
        connected &&
        !ports.readonly &&
        !inputPaused &&
        (inputControl === undefined
          ? processAlive && ports.source?.input !== false
          : !!inputControl && inputControl.controller === "human" && !inputControl.frozen) &&
        !ports.previousFailure.current &&
        ports.previousFailure.available !== false &&
        !pump.needsAcknowledgement;
      view.terminal.options.disableStdin = !enabled;
      return enabled;
    };
    let rebindInput: (() => void) | undefined;
    const updateInput: TerminalControls["updateInput"] = (next, paused) => {
      const changed =
        inputControl?.controller !== next?.controller ||
        inputControl?.revision !== next?.revision ||
        inputControl?.frozen !== next?.frozen ||
        (inputControl === undefined) !== (next === undefined) ||
        (inputControl === null) !== (next === null) ||
        inputPaused !== paused;
      if (!changed) return;
      // Drop native composition snapshots/timers along with old queued bytes.
      rebindInput?.();
      view.terminal.options.disableStdin = true;
      if (pump.hasActiveInput || pump.needsAcknowledgement) ports.previousFailure.current = true;
      if (pump.hasActiveInput) retired.add(pump);
      pump.dispose(); // Discard pending old-revision bytes before a fresh binding exists.
      inputControl = next;
      inputPaused = paused;
      if (ports.source)
        connection.replaceInputTransport(
          bindExecutionInput(ports.api, ports.source, next, ports.readonly),
        );
      pump = new UserTerminalInputPump(connection, abort.signal);
      for (const old of retired) if (!old.hasActiveInput) retired.delete(old);
      ports.inputFailure(ports.previousFailure.current);
      restoreFreshInput();
    };
    ports.controls({
      adapter: view,
      get pump() {
        return pump;
      },
      restoreFreshInput,
      hasActiveInput,
      updateInput,
    });
    own(
      ports.previousFailure.subscribe?.(() => {
        if (!active()) return;
        restoreFreshInput();
        ports.inputFailure(ports.previousFailure.current);
        ports.notice(
          ports.previousFailure.current
            ? "Input delivery was not confirmed. Check the shell before enabling fresh input."
            : "Previous input will not be retried. Only fresh typing will be sent.",
        );
      }) ?? (() => {}),
    );
    let resizeRunning = false;
    let latestGeometry: { cols: number; rows: number } | null = null;
    const resize = Effect.suspend(() => {
      if (
        ports.readonly ||
        (ports.source && ports.source.origin !== "human" && ports.source.resize === false)
      ) {
        if (ports.source) view.terminal.resize(ports.source.cols, ports.source.rows);
        return Effect.void;
      }
      const geometry = view.fit();
      if (geometry) latestGeometry = geometry;
      if (resizeRunning || !connected || !processAlive || ports.source?.resize === false)
        return Effect.void;
      resizeRunning = true;
      return Effect.gen(function* () {
        while (latestGeometry && active() && processAlive) {
          const next = latestGeometry;
          latestGeometry = null;
          yield* operation("resize", () => connection.resize(next.cols, next.rows, abort.signal));
        }
      }).pipe(
        // Exited-process geometry failure must not interrupt retained output replay.
        Effect.catchAll((failure) =>
          Effect.sync(() => {
            if (active())
              ports.notice(
                `Terminal resize failed: ${message(failure.cause, "geometry control unavailable")}`,
              );
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            resizeRunning = false;
          }),
        ),
      );
    });
    const send = (bytes: Uint8Array) => {
      const textarea = view.terminal.textarea;
      if (
        !active() ||
        !connected ||
        ports.readonly ||
        inputPaused ||
        view.terminal.options.disableStdin ||
        ports.previousFailure.current ||
        ports.previousFailure.available === false ||
        !textarea ||
        textarea.ownerDocument.activeElement !== textarea
      )
        return;
      const sender = pump;
      run(
        operation("input", () => sender.send(bytes)).pipe(
          Effect.catchAll((failure) =>
            Effect.sync(() => {
              if (!active()) return;
              ports.notice(message(failure.cause, "Terminal input failed"));
              if (
                failure.cause instanceof TerminalInputNotSentError &&
                failure.cause.cause instanceof TerminalInputRejectedError
              ) {
                // A definite rejection discarded its queue and wrote no bytes.
                // Permit only fresh events; existing uncertainty remains sealed.
                sender.acknowledgeFailure();
                restoreFreshInput();
              } else if (sender.needsAcknowledgement) {
                ports.previousFailure.current = true;
                view.terminal.options.disableStdin = true;
                ports.inputFailure(true);
              }
            }),
          ),
        ),
      );
    };
    let releaseInput = observeHumanTerminalInput(view.terminal, send);
    rebindInput = () => {
      releaseInput();
      releaseInput = observeHumanTerminalInput(view.terminal, send);
    };
    own(() => {
      releaseInput();
      rebindInput = undefined;
    });
    const observer = new ResizeObserver(() => run(resize));
    own(() => observer.disconnect());
    observer.observe(ports.host);
    if (view.terminal.element) observer.observe(view.terminal.element);

    ports.phase("Connecting");
    ports.notice("");
    ports.inputFailure(ports.previousFailure.current);
    const status = yield* operation("attach", () =>
      connection.attach(abort.signal, ports.reconnect ? "reconnect" : "attach"),
    );
    if (!active()) return;
    connected = true;
    processAlive = status.alive;
    // Attach observes only. Fresh focused keyboard events carry human intent;
    // only actual unconfirmed delivery requires a separate acknowledgement.
    restoreFreshInput();
    if (ports.previousFailure.current)
      ports.notice(
        "Input delivery was not confirmed. Check the shell before enabling fresh input.",
      );
    if (ports.previousFailure.available === false)
      ports.notice(
        "Input recovery storage is full. Acknowledge earlier failures, then reconnect before typing in another terminal.",
      );
    ports.phase(status.alive ? "Connected" : "Retained output");
    yield* resize;
    void document.fonts.ready.then(() => {
      if (active()) run(resize);
    });
    yield* operation("observe", () =>
      connection.run(abort.signal, (frame) => {
        processAlive = frame.terminal.alive;
        if (!processAlive) latestGeometry = null;
        restoreFreshInput();
        if (frame.gap && active())
          ports.notice(
            "Earlier output was discarded. The display was reset before retained output was replayed.",
          );
      }),
    );
    if (active()) {
      // A completed collector is not input authority. Shared input remains
      // bound to separately queried current control; legacy behavior is kept.
      if (inputControl === undefined) connected = false;
      restoreFreshInput();
      ports.phase("Output complete");
    }
  });
  run(observe);
  return () => {
    // Fence every async callback before synchronously releasing this activation.
    abort.abort();
    Effect.runSync(Scope.close(scope, Exit.void));
  };
}
