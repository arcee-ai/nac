import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useOpenUserTerminal, useExecutions, useStopExecution } from "./queries";
import type { ExecutionStatus } from "../../../../packages/nac-client/src/index";
import { ExecutionLog } from "./ExecutionLog";
import { useTerminalController } from "./useTerminalController";

export interface TerminalSelectionCapture {
  readonly sessionId: string;
  readonly terminalId: string;
  readonly selectedText: string;
  readonly capturedAtMs: string;
  readonly sourceAlive: boolean;
}
export interface TerminalPaneProps {
  sessionId: string;
  onReviewSelection?: (capture: Readonly<TerminalSelectionCapture>) => void;
  /** Composition slot; historical opening observes the same source read-only. */
  history?: (observe: (source: ExecutionStatus) => void) => ReactNode;
}

export function TerminalPane(props: TerminalPaneProps) {
  const { api } = useNativeRuntime();
  // A replaced consumer binding discards selection, handles and pending UI work.
  const binding = useMemo(() => ({ api, id: crypto.randomUUID() }), [api]);
  return <TerminalPaneOwner key={`${binding.id}:${props.sessionId}`} {...props} />;
}

function TerminalPaneOwner({ sessionId, onReviewSelection, history }: TerminalPaneProps) {
  const list = useExecutions(sessionId);
  const open = useOpenUserTerminal(sessionId);
  const [selected, setSelected] = useState<string | null>(null);
  const [historical, setHistorical] = useState<ExecutionStatus | null>(null);
  const launchId = useRef<string | null>(null);
  const terminals = list.data?.executions ?? [];
  const id = selected ?? terminals[0]?.id;
  const source = historical?.id === id ? historical : terminals.find((item) => item.id === id);
  const observeHistory = (source: ExecutionStatus) => {
    setHistorical({ ...source, input: false, resize: false, stop: false, retained: false });
    setSelected(source.id);
  };
  if (selected == null && source) setSelected(source.id);
  const launch = () => {
    launchId.current ??= crypto.randomUUID();
    open.mutate(launchId.current, {
      onSuccess: (result) => {
        setHistorical(null);
        setSelected(result.terminal_id);
        launchId.current = null;
      },
    });
  };
  return (
    <section aria-label="Session terminal" className="flex flex-col flex-1 min-h-0 gap-2 p-3">
      <div className="flex items-center flex-wrap gap-2">
        <label className="sr-only" htmlFor={`terminal-${sessionId}`}>
          Shell
        </label>
        <select
          id={`terminal-${sessionId}`}
          aria-label="Shell"
          value={id ?? ""}
          onChange={(event) => {
            setHistorical(null);
            setSelected(event.target.value);
          }}
          className="min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1 text-sm"
        >
          {!id ? <option value="">No shell</option> : null}
          {id && !terminals.some((item) => item.id === id) ? (
            <option value={id}>Selected shell unavailable</option>
          ) : null}
          {terminals.map((item, index) => (
            <option key={item.id} value={item.id}>
              {item.origin === "human"
                ? "Human shell"
                : item.origin === "human_command"
                  ? "! command"
                  : item.representation === "pty"
                    ? "Agent PTY"
                    : "Agent command"}{" "}
              {index + 1}
              {item.process_state === "cleanup_pending"
                ? " (cleanup pending)"
                : item.alive
                  ? " (running)"
                  : " (settled)"}
            </option>
          ))}
        </select>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Secondary}
          disabled={open.isPending}
          onClick={launch}
        >
          {open.isPending
            ? "Opening shell…"
            : open.isError
              ? "Retry opening same shell"
              : "New shell"}
        </Button>
      </div>
      <p className="text-sm text-basic-secondary">
        Human shells, agent executions and ! commands use the chat’s existing execution environment.
      </p>
      {list.isError ? (
        <p role="alert">
          Shell list unavailable.{" "}
          <Button
            size={ButtonSize.Small}
            type="button"
            onClick={() => {
              void list.refetch();
            }}
          >
            Refresh
          </Button>
        </p>
      ) : null}
      {open.isError ? (
        <p role="alert">
          {open.error.message} Opening was not confirmed; retry uses the same launch identity.
        </p>
      ) : null}
      {history?.(observeHistory)}
      {historical ? (
        <Button
          type="button"
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          onClick={() => setHistorical(null)}
        >
          Return to live source
        </Button>
      ) : null}
      {source ? (
        <ExecutionDisplay
          key={`${source.id}:${historical ? "history" : "live"}`}
          sessionId={sessionId}
          source={source}
          historical={historical != null}
          onReviewSelection={onReviewSelection}
        />
      ) : (
        <p role="status">
          {id
            ? "Selected execution unavailable."
            : list.isPending
              ? "Loading executions…"
              : "Open a shell to start typing. Terminal output stays separate from the conversation."}
        </p>
      )}
    </section>
  );
}

function ExecutionDisplay({
  sessionId,
  source,
  onReviewSelection,
  historical = false,
}: TerminalPaneProps & { source: ExecutionStatus; historical?: boolean }) {
  const stop = useStopExecution(sessionId, source.id);
  return (
    <>
      <code aria-label="Execution identity" className="break-all text-xs text-basic-secondary">
        {source.id}
      </code>
      <p className="text-sm text-basic-secondary break-words">
        {source.origin === "human"
          ? "Human shell"
          : source.origin === "human_command"
            ? "Human ! command"
            : "Agent execution"}
        {` · ${source.backend} · ${source.cwd} · ${source.process_state.replaceAll("_", " ")}`}
        {source.exit_code == null ? "" : ` (${source.exit_code})`}
        {source.output_complete ? " · collection complete" : " · collecting output"}
        {historical || source.origin !== "human" ? " · Read-only" : ""}
      </p>
      {!historical ? (
        <div>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            disabled={!source.stop || stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending
              ? "Stopping…"
              : source.origin === "human"
                ? "Close shell"
                : "Stop execution"}
          </Button>
        </div>
      ) : null}
      {stop.isError ? (
        <p role="alert">{stop.error.message} Stop was not confirmed; check its status.</p>
      ) : null}
      {source.output_error ? <p role="alert">{source.output_error}</p> : null}
      {source.representation === "log" ? (
        <ExecutionLog sessionId={sessionId} source={source} />
      ) : (
        <TerminalDisplay
          sessionId={sessionId}
          source={source}
          historical={historical}
          onReviewSelection={
            !historical && source.origin === "human" ? onReviewSelection : undefined
          }
        />
      )}
    </>
  );
}

function TerminalDisplay({
  sessionId,
  source,
  onReviewSelection,
  historical = false,
}: TerminalPaneProps & { source: ExecutionStatus; historical?: boolean }) {
  const terminalId = source.id;
  const status = { data: source };
  const [binding] = useState(() => source);
  const element = useRef<HTMLDivElement>(null);
  const controller = useTerminalController(sessionId, terminalId, element, binding);
  const review = () => {
    const text = controller.selection();
    if (!text || !onReviewSelection) return;
    onReviewSelection(
      Object.freeze({
        sessionId,
        terminalId,
        selectedText: text,
        capturedAtMs: String(Date.now()),
        sourceAlive: status.data?.alive ?? false,
      }),
    );
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status">
          {controller.phase}
          {status.data && !status.data.alive
            ? ` · Exited${status.data.exit_code == null ? "" : ` (${status.data.exit_code})`}`
            : ""}
        </span>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Ghost}
          onClick={controller.focus}
        >
          Focus terminal
        </Button>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Ghost}
          disabled={controller.phase === "Connecting"}
          onClick={controller.reconnect}
        >
          Reconnect
        </Button>
        {onReviewSelection ? (
          <Button
            size={ButtonSize.Small}
            type="button"
            variant={ButtonVariant.Ghost}
            onClick={review}
          >
            Review selected text
          </Button>
        ) : null}
      </div>
      {controller.notice ? <p role="alert">{controller.notice}</p> : null}
      {!historical && source.origin === "human" && controller.inputFailure ? (
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Secondary}
          onClick={controller.acknowledgeInput}
        >
          Acknowledge failure and enable fresh input
        </Button>
      ) : null}
      <div
        ref={element}
        role="region"
        aria-label="Interactive terminal"
        className="flex-1 min-h-32 overflow-auto"
        style={{ background: "#151719" }}
      />
    </>
  );
}
