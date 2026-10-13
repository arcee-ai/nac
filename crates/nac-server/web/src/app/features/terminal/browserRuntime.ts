import { Cause, Data, Effect, Exit, Option, Scope } from "effect";
import {
  UserTerminalConnection,
  UserTerminalInputPump,
  type UserTerminalApi,
} from "../../../../packages/nac-client/src/index";
import { createTerminalRenderer } from "./xtermAdapter";

type Adapter = Awaited<ReturnType<typeof createTerminalRenderer>>;
export interface TerminalControls {
  adapter: Adapter;
  pump: UserTerminalInputPump;
}
interface TerminalPorts {
  api: UserTerminalApi;
  sessionId: string;
  terminalId: string;
  host: HTMLDivElement;
  reconnect: boolean;
  previousFailure: { current: boolean };
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
  const disconnected = (cause: unknown) => {
    if (!active()) return;
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
    const connection = new UserTerminalConnection(
      ports.api,
      ports.sessionId,
      ports.terminalId,
      view.renderer,
      { pageLimit: 32_768 },
    );
    own(() => {
      // Detach is SDK observer cleanup, never shell/agent cancellation.
      void connection.detach().catch(() => {});
    });
    const pump = new UserTerminalInputPump(connection, abort.signal);
    own(() => {
      if (pump.hasActiveInput || pump.needsAcknowledgement) ports.previousFailure.current = true;
      pump.dispose();
      ports.controls(null);
    });
    ports.controls({ adapter: view, pump });
    let connected = false;
    let processAlive = false;
    let resizeRunning = false;
    let latestGeometry: { cols: number; rows: number } | null = null;
    const resize = Effect.suspend(() => {
      const geometry = view.fit();
      if (geometry) latestGeometry = geometry;
      if (resizeRunning || !connected || !processAlive) return Effect.void;
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
      if (!active() || !connected || view.terminal.options.disableStdin) return;
      run(
        operation("input", () => pump.send(bytes)).pipe(
          Effect.catchAll((failure) =>
            Effect.sync(() => {
              if (!active()) return;
              ports.notice(message(failure.cause, "Terminal input failed"));
              if (pump.needsAcknowledgement) {
                ports.previousFailure.current = true;
                view.terminal.options.disableStdin = true;
                ports.inputFailure(true);
              }
            }),
          ),
        ),
      );
    };
    const keyboard = view.terminal.onData((data) => send(new TextEncoder().encode(data)));
    own(() => keyboard.dispose());
    const binary = view.terminal.onBinary((data) =>
      send(Uint8Array.from(data, (character) => character.charCodeAt(0))),
    );
    own(() => binary.dispose());
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
    view.terminal.options.disableStdin = !status.alive || ports.previousFailure.current;
    if (ports.previousFailure.current)
      ports.notice(
        "Input delivery was not confirmed. Check the shell before enabling fresh input.",
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
        if (frame.gap && active())
          ports.notice(
            "Earlier output was discarded. The display was reset before retained output was replayed.",
          );
      }),
    );
    if (active()) {
      view.terminal.options.disableStdin = true;
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
