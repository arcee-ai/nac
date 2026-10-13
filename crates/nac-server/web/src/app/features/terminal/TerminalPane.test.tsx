/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { TerminalPane, type TerminalPaneProps } from "./TerminalPane";
import type {
  UserTerminalFrameResponse,
  UserTerminalResponse,
  ExecutionStatus,
} from "../../../../packages/nac-client/src/index";
import { recoveryForRuntime } from "./inputRecovery";

const renderer = vi.hoisted(() => ({
  keyboard: undefined as undefined | ((data: string) => void),
  generatedData: undefined as undefined | ((data: string) => void),
  write: vi.fn(async (_bytes: Uint8Array, _signal: AbortSignal) => {}),
  reset: vi.fn(async () => {}),
  selection: vi.fn(() => "selected private output"),
  dispose: vi.fn(),
  fit: vi.fn<() => { cols: number; rows: number } | null>(() => null),
  options: { disableStdin: true },
}));
vi.mock("./xtermAdapter", () => ({
  createTerminalRenderer: async (host: HTMLElement) => {
    const textarea = document.createElement("textarea");
    host.append(textarea);
    return {
      renderer: { write: renderer.write, reset: renderer.reset },
      terminal: {
        options: renderer.options,
        textarea,
        resize: vi.fn(),
        onKey: (callback: (event: { key: string; domEvent: KeyboardEvent }) => void) => {
          renderer.keyboard = (key) =>
            callback({ key, domEvent: { isTrusted: true } as KeyboardEvent });
          return {
            dispose: () => {
              renderer.keyboard = undefined;
            },
          };
        },
        onData: (callback: (data: string) => void) => {
          renderer.generatedData = callback;
          return {
            dispose: () => {
              renderer.generatedData = undefined;
            },
          };
        },
        onBinary: () => ({ dispose: () => {} }),
        focus: () => textarea.focus(),
        getSelection: renderer.selection,
      },
      fit: renderer.fit,
      dispose: renderer.dispose,
    };
  },
}));

const terminal = {
  protocol_version: 1,
  terminal_id: "opaque-shell",
  cols: 80,
  rows: 24,
  alive: true,
  output_complete: false,
};
const clients: QueryClient[] = [];
function pending(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
function fixture(
  status: UserTerminalResponse = terminal,
  sources?: ExecutionStatus[],
  history?: TerminalPaneProps["history"],
) {
  const api = {
    ...standaloneRuntime.api,
    listExecutions: vi.fn(async () => ({
      protocol_version: 1,
      executions: sources ?? [
        {
          id: status.terminal_id,
          origin: "human" as const,
          representation: "pty" as const,
          cwd: "/workspace",
          backend: "local",
          request_id: null,
          alive: status.alive,
          process_state: status.alive ? ("running" as const) : ("settled" as const),
          output_error: null,
          output_complete: status.output_complete,
          input: status.alive,
          resize: status.alive,
          stop: status.alive,
          retained: true,
          cols: status.cols,
          rows: status.rows,
          exit_code: status.exit_code ?? null,
        },
      ],
    })),
    inputControlledTerminal: vi.fn<typeof standaloneRuntime.api.inputControlledTerminal>(),
    getTerminalInputControl: vi.fn(async (_session: string, id: string) => {
      const found = sources?.find((source) => source.id === id);
      if (!(found?.alive ?? status.alive))
        throw new Error("Control unavailable for settled source");
      return {
        controller:
          (found?.origin ?? "human") === "human" ? ("human" as const) : ("agent" as const),
        revision: "1",
        in_flight: false,
        frozen: false,
      };
    }),
    transferTerminalInputControl: vi.fn(
      async (
        _session: string,
        _id: string,
        body: { controller: "human" | "agent"; expected_revision: string },
      ) => ({
        controller: body.controller,
        revision: String(BigInt(body.expected_revision) + 1n),
        in_flight: false,
        frozen: false,
      }),
    ),
    getUserTerminal: vi.fn(async () => status),
    openUserTerminal: vi.fn(async () => status),
    attachUserTerminal: vi.fn(async (_session: string, id: string) => ({
      protocol_version: 1,
      observer_id: "observer",
      idle_expiry_ms: 30_000,
      terminal: { ...status, terminal_id: id },
    })),
    pullUserTerminal: vi.fn<typeof standaloneRuntime.api.pullUserTerminal>(
      async (_session, _id, _observer, _body, signal) => pending(signal),
    ),
    detachUserTerminal: vi.fn(async () => {}),
    inputUserTerminal: vi.fn<typeof standaloneRuntime.api.inputUserTerminal>(async () => {}),
    resizeUserTerminal: vi.fn(async () => {}),
    terminateTerminal: vi.fn(async () => {}),
  };
  api.inputControlledTerminal = vi.fn(
    async (
      session: string,
      id: string,
      body: { protocol_version: number; bytes: number[]; expected_revision: string },
      signal?: AbortSignal,
    ) => {
      await api.inputUserTerminal(
        session,
        id,
        { protocol_version: body.protocol_version, bytes: body.bytes },
        signal,
      );
      return { outcome: "written" as const, error: null };
    },
  );
  const executionApi = {
    ...api,
    attachExecution: api.attachUserTerminal,
    pullExecution: async (...args: Parameters<typeof api.pullUserTerminal>) => ({
      ...(await api.pullUserTerminal(...args)),
      execution: (await api.listExecutions()).executions[0],
      segments: [],
    }),
    detachExecution: api.detachUserTerminal,
    stopExecution: api.terminateTerminal,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const review = vi.fn();
  const runtime = { ...standaloneRuntime, api: executionApi };
  const view = render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={client}>
        <TerminalPane sessionId="session" onReviewSelection={review} history={history} />
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  return { ...view, api, client, review, runtime };
}
beforeEach(() => {
  vi.clearAllMocks();
  renderer.options.disableStdin = true;
  renderer.fit.mockReturnValue(null);
  renderer.write.mockImplementation(async () => {});
  renderer.selection.mockReturnValue("selected private output");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

const readOnlySource: ExecutionStatus = {
  id: "opaque-shell",
  origin: "agent",
  representation: "pty",
  cwd: "/workspace",
  backend: "local",
  request_id: null,
  alive: true,
  process_state: "running",
  exit_code: null,
  output_error: null,
  output_complete: false,
  input: false,
  resize: false,
  stop: true,
  retained: true,
  cols: 120,
  rows: 40,
};

describe("terminal pane lifetime and explicit user actions", () => {
  it("waits for parsing before ACK, sends literal control input, and detaches without terminating", async () => {
    let parsed: () => void = () => {};
    renderer.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          parsed = resolve;
        }),
    );
    const f = fixture();
    const frame: UserTerminalFrameResponse = {
      protocol_version: 1,
      observer_id: "observer",
      terminal,
      bytes: [65],
      offset: "0",
      next_offset: "1",
      retained_start: "0",
      retained_end: "1",
      gap: false,
      caught_up: true,
      requires_ack: true,
    };
    f.api.pullUserTerminal.mockResolvedValueOnce(frame);
    await waitFor(() => expect(renderer.write).toHaveBeenCalledTimes(1));
    expect(f.api.pullUserTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("\u0003");
    });
    expect(f.api.inputUserTerminal.mock.calls[0]?.[2]).toEqual({ protocol_version: 1, bytes: [3] });
    await act(async () => parsed());
    await waitFor(() => expect(f.api.pullUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.pullUserTerminal.mock.calls[1][3]).toMatchObject({ acknowledge_offset: "1" });
    f.unmount();
    expect(f.api.detachUserTerminal).toHaveBeenCalledWith(
      "session",
      "opaque-shell",
      "observer",
      undefined,
    );
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("fits exited history locally and replays its final bytes without process resize", async () => {
    renderer.fit.mockReturnValue({ cols: 91, rows: 31 });
    const exited = { ...terminal, alive: false, output_complete: true, exit_code: 7 };
    const f = fixture(exited);
    f.api.resizeUserTerminal.mockRejectedValue(new Error("user terminal has exited"));
    f.api.pullUserTerminal
      .mockResolvedValueOnce({
        protocol_version: 1,
        observer_id: "observer",
        terminal: exited,
        bytes: [65],
        offset: "0",
        next_offset: "1",
        retained_start: "0",
        retained_end: "1",
        gap: false,
        caught_up: true,
        requires_ack: true,
      })
      .mockResolvedValueOnce({
        protocol_version: 1,
        observer_id: "observer",
        terminal: exited,
        bytes: [],
        offset: "1",
        next_offset: "1",
        retained_start: "0",
        retained_end: "1",
        gap: false,
        caught_up: true,
        requires_ack: false,
      });
    await screen.findByText("Output complete · Exited (7)");
    expect(renderer.fit).toHaveBeenCalled();
    expect(renderer.write).toHaveBeenCalledWith(Uint8Array.of(65), expect.any(AbortSignal));
    expect(f.api.pullUserTerminal.mock.calls[1][3]).toMatchObject({ acknowledge_offset: "1" });
    expect(f.api.resizeUserTerminal).not.toHaveBeenCalled();
    expect(renderer.options.disableStdin).toBe(true);
    expect(screen.queryByText("Disconnected")).toBeNull();
  });

  it("acknowledges retained-source uncertainty without enabling ended input", async () => {
    const exited = { ...terminal, alive: false, output_complete: true, exit_code: 0 };
    const f = fixture(exited);
    const lease = recoveryForRuntime(f.runtime).acquire("session", terminal.terminal_id);
    lease.current = true;
    lease.release();
    await screen.findByText("Retained output · Exited (0)");
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge failure and enable fresh input" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => renderer.keyboard?.("must not send\r"));
    expect(renderer.options.disableStdin).toBe(true);
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
  });

  it("reports a live process resize failure without disconnecting independent observation", async () => {
    renderer.fit.mockReturnValue({ cols: 91, rows: 31 });
    const f = fixture();
    f.api.resizeUserTerminal.mockRejectedValue(new Error("geometry control failed"));
    await screen.findByText("Connected");
    await screen.findByText(/Terminal resize failed: geometry control failed/);
    await waitFor(() => expect(f.api.pullUserTerminal).toHaveBeenCalled());
    expect(screen.queryByText("Disconnected")).toBeNull();
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });

  it("does not replay uncertain input and requires acknowledgement before fresh typing", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    f.api.inputUserTerminal.mockRejectedValueOnce(new Error("reply lost"));
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("old command\r");
    });
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(1);
    expect(renderer.options.disableStdin).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("must not send\r");
    });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(1);
    expect(renderer.options.disableStdin).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge failure and enable fresh input" }),
    );
    await waitFor(() => expect(renderer.options.disableStdin).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("new\r");
    });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(2);
    expect(f.api.inputUserTerminal.mock.calls[1]?.[2]).toEqual({
      protocol_version: 1,
      bytes: [110, 101, 119, 13],
    });
  });

  it("retains unconfirmed delivery across source-view remount without replay", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    f.api.inputUserTerminal.mockRejectedValueOnce(new Error("receipt lost"));
    await act(async () => renderer.keyboard?.("old\r"));
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    f.unmount();
    const remounted = render(
      <RuntimeContext.Provider value={f.runtime}>
        <QueryClientProvider client={f.client}>
          <TerminalPane sessionId="session" onReviewSelection={f.review} />
        </QueryClientProvider>
      </RuntimeContext.Provider>,
    );
    await screen.findByText("Connected");
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => renderer.keyboard?.("must not send\r"));
    expect(f.api.inputUserTerminal).toHaveBeenCalledOnce();
    expect(renderer.options.disableStdin).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge failure and enable fresh input" }),
    );
    await waitFor(() => expect(renderer.options.disableStdin).toBe(false));
    await act(async () => renderer.keyboard?.("fresh\r"));
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(2);
    expect(f.api.inputUserTerminal.mock.calls[1][2].bytes).toEqual([102, 114, 101, 115, 104, 13]);
    remounted.unmount();
  });

  it("accepts fresh input on attach and reconnect without sending automatic bytes", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    expect(renderer.options.disableStdin).toBe(false);
    expect(screen.queryByRole("button", { name: "Enable terminal input" })).toBeNull();
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("fresh\r");
    });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    await screen.findByText("Connected");
    expect(renderer.options.disableStdin).toBe(false);
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("new\r");
    });
    expect(f.api.inputUserTerminal.mock.calls.map((call) => call[2].bytes)).toEqual([
      [102, 114, 101, 115, 104, 13],
      [110, 101, 119, 13],
    ]);
  });

  it("does not forward renderer device-query replies while observation is unfocused", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    await act(async () => renderer.generatedData?.("\u001b[9;1R"));
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => renderer.generatedData?.("\u001b[9;1R"));
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
    await act(async () => renderer.keyboard?.("fresh\r"));
    expect(f.api.inputUserTerminal).toHaveBeenCalledOnce();
  });

  it("captures selection only on Review and keeps it out of query caches and DOM attributes", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    expect(f.review).not.toHaveBeenCalled();
    expect(renderer.selection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review selected text" }));
    expect(f.review).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session",
        terminalId: "opaque-shell",
        selectedText: "selected private output",
        sourceAlive: true,
      }),
    );
    expect(Object.isFrozen(f.review.mock.calls[0][0])).toBe(true);
    expect(
      JSON.stringify(
        f.client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain("selected private output");
    expect(f.container.innerHTML).not.toContain("selected private output");
  });

  it("explains an empty explicit selection without creating a draft", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    renderer.selection.mockReturnValueOnce("");
    fireEvent.click(screen.getByRole("button", { name: "Review selected text" }));
    await screen.findByText("Select text in the terminal before reviewing it.");
    expect(f.review).not.toHaveBeenCalled();
  });

  it("stops a failed observer and reconnects only when explicitly requested", async () => {
    const f = fixture();
    f.api.pullUserTerminal.mockRejectedValueOnce(new Error("observer expired"));
    await screen.findByText("Disconnected");
    expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.detachUserTerminal).toHaveBeenCalledTimes(1);
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });

  it("retries an unconfirmed launch with its original identity", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    f.api.openUserTerminal.mockRejectedValueOnce(new Error("launch reply lost"));
    fireEvent.click(screen.getByRole("button", { name: "New shell" }));
    await screen.findByRole("button", { name: "Retry opening same shell" });
    const first = f.api.openUserTerminal.mock.calls[0];
    fireEvent.click(screen.getByRole("button", { name: "Retry opening same shell" }));
    await waitFor(() => expect(f.api.openUserTerminal).toHaveBeenCalledTimes(2));
    expect(f.api.openUserTerminal.mock.calls[1]).toEqual(first);
  });
  it("observes a retained agent PTY without input, process resize, retention or selection authority", async () => {
    const f = fixture(terminal, [readOnlySource]);
    await screen.findByText("Connected");
    expect(screen.getByRole("option", { name: /Agent PTY/ })).toBeTruthy();
    expect(screen.getByLabelText("Input controller").textContent).toBe("Input: Agent");
    expect(screen.getByRole("button", { name: "Take control" })).toBeTruthy();
    await act(async () => {
      renderer.keyboard?.("must not send\r");
    });
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
    expect(f.api.resizeUserTerminal).not.toHaveBeenCalled();
    expect(f.api.openUserTerminal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Review selected text" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop execution" }));
    await waitFor(() =>
      expect(f.api.terminateTerminal).toHaveBeenCalledWith("session", "opaque-shell"),
    );
  });

  it("renders active pipe output as an inert bounded log and detaches without stopping it", async () => {
    const source = {
      ...readOnlySource,
      representation: "log" as const,
      retained: false,
      cols: 0,
      rows: 0,
    };
    const f = fixture(terminal, [source]);
    const bytes = Array.from(new TextEncoder().encode("pipe \x1b[2J<b>literal</b>"));
    f.api.pullUserTerminal.mockResolvedValueOnce({
      protocol_version: 1,
      observer_id: "observer",
      terminal,
      bytes,
      offset: "0",
      next_offset: String(bytes.length),
      retained_start: "0",
      retained_end: String(bytes.length),
      gap: false,
      caught_up: true,
      requires_ack: true,
    });
    const log = await screen.findByRole("region", { name: "Execution log" });
    await waitFor(() => expect(log.textContent).toBe("pipe \\x1b[2J<b>literal</b>"));
    expect(log.querySelector("b")).toBeNull();
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
    expect(f.api.resizeUserTerminal).not.toHaveBeenCalled();
    f.unmount();
    await waitFor(() => expect(f.api.detachUserTerminal).toHaveBeenCalled());
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
  });
  it("keeps actual input uncertainty when switching away from and back to a source", async () => {
    const human = { ...readOnlySource, origin: "human" as const, input: true, resize: true };
    const other = { ...readOnlySource, id: "other-shell" };
    const f = fixture(terminal, [human, other]);
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    f.api.inputUserTerminal.mockRejectedValueOnce(new Error("reply lost"));
    await act(async () => {
      renderer.keyboard?.("uncertain command\r");
    });
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    fireEvent.change(screen.getByRole("combobox", { name: "Shell" }), {
      target: { value: other.id },
    });
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole("combobox", { name: "Shell" }), {
      target: { value: human.id },
    });
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(3));
    await screen.findByText("Connected");
    expect(renderer.options.disableStdin).toBe(true);
    await screen.findByRole("button", { name: "Acknowledge failure and enable fresh input" });
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => {
      renderer.keyboard?.("fresh typing before acknowledgement\r");
    });
    expect(f.api.inputUserTerminal).toHaveBeenCalledTimes(1);
  });
  it("opens historical output without inheriting live controls for the same source", async () => {
    const human = { ...readOnlySource, origin: "human" as const, input: true, resize: true };
    const f = fixture(terminal, [human], (observe) => (
      <button onClick={() => observe(human)}>Reopen historical source</button>
    ));
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Reopen historical source" }));
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(2));
    await screen.findByText("Connected");
    expect(renderer.options.disableStdin).toBe(true);
    expect(screen.queryByRole("button", { name: "Close shell" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review selected text" })).toBeNull();
    expect(screen.queryByLabelText("Terminal input ownership")).toBeNull();
    expect(f.api.transferTerminalInputControl).not.toHaveBeenCalled();
    await act(async () => {
      renderer.keyboard?.("historical input forbidden\r");
    });
    expect(f.api.inputUserTerminal).not.toHaveBeenCalled();
    expect(f.api.terminateTerminal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Return to live source" }));
    await waitFor(() => expect(f.api.attachUserTerminal).toHaveBeenCalledTimes(3));
    await screen.findByText("Connected");
    expect(renderer.options.disableStdin).toBe(false);
  });
  it("takes and returns retained agent input without reattaching or replaying literal keys", async () => {
    const f = fixture(terminal, [readOnlySource]);
    await screen.findByText("Connected");
    expect(renderer.options.disableStdin).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await waitFor(() => expect(renderer.options.disableStdin).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => renderer.keyboard?.("π<RET>\r"));
    expect(f.api.inputControlledTerminal).toHaveBeenCalledOnce();
    expect(f.api.inputControlledTerminal.mock.calls[0][2]).toEqual({
      protocol_version: 1,
      expected_revision: "2",
      bytes: Array.from(new TextEncoder().encode("π<RET>\r")),
    });
    expect(f.api.attachUserTerminal).toHaveBeenCalledOnce();
    expect(f.api.transferTerminalInputControl.mock.calls[0][2]).toMatchObject({
      expected_revision: "1",
      controller: "human",
      acknowledge_uncertainty: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Give agent control" }));
    await screen.findByRole("button", { name: "Take control" });
    await act(async () => renderer.keyboard?.("stale\r"));
    expect(renderer.options.disableStdin).toBe(true);
    expect(f.api.inputControlledTerminal).toHaveBeenCalledOnce();
    expect(f.api.attachUserTerminal).toHaveBeenCalledOnce();
    expect(f.api.openUserTerminal).not.toHaveBeenCalled();
  });
  it("reclaims a human shell and ignores late older control data", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Give agent control" }));
    await screen.findByRole("button", { name: "Reclaim input" });
    expect(renderer.options.disableStdin).toBe(true);
    // GET still returns revision 1/Human after POST revision 2/Agent.
    await act(async () => {
      await f.client.invalidateQueries({
        queryKey: ["session", "session", "execution", terminal.terminal_id, "input-control"],
      });
    });
    expect(screen.getByLabelText("Input controller").textContent).toBe("Input: Agent");
    fireEvent.click(screen.getByRole("button", { name: "Reclaim input" }));
    await waitFor(() => expect(renderer.options.disableStdin).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => renderer.keyboard?.("fresh\r"));
    expect(f.api.inputControlledTerminal.mock.calls[0][2].expected_revision).toBe("3");
    expect(f.api.attachUserTerminal).toHaveBeenCalledOnce();
  });
  it("reconciles an unknown control transfer without retrying the action", async () => {
    const f = fixture(terminal, [readOnlySource]);
    await screen.findByText("Connected");
    f.api.transferTerminalInputControl.mockRejectedValueOnce(new Error("control reply lost"));
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await screen.findByText(/control reply lost/);
    await waitFor(() => expect(f.api.getTerminalInputControl).toHaveBeenCalledTimes(2));
    expect(f.api.transferTerminalInputControl).toHaveBeenCalledOnce();
    expect(renderer.options.disableStdin).toBe(true);
    expect(f.api.inputControlledTerminal).not.toHaveBeenCalled();
    expect(f.api.attachUserTerminal).toHaveBeenCalledOnce();
  });
  it("keeps definite rejection distinct from unknown delivery and never retries its bytes", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    f.api.inputControlledTerminal.mockResolvedValueOnce({
      outcome: "rejected",
      error: "controller changed",
    });
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    await act(async () => renderer.keyboard?.("rejected\r"));
    expect(f.api.inputControlledTerminal).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Acknowledge failure and enable fresh input" }),
    ).toBeNull();
    expect(renderer.options.disableStdin).toBe(false);
    await act(async () => renderer.keyboard?.("fresh\r"));
    expect(f.api.inputControlledTerminal).toHaveBeenCalledTimes(2);
    expect(f.api.inputControlledTerminal.mock.calls[1][2].bytes).toEqual(
      Array.from(new TextEncoder().encode("fresh\r")),
    );
  });
  it("binds confirmed recovery revision and focuses only fresh input after asynchronous ACK", async () => {
    const f = fixture();
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Focus terminal" }));
    f.api.inputUserTerminal.mockRejectedValueOnce(new Error("receipt lost"));
    await act(async () => renderer.keyboard?.("old\r"));
    const acknowledge = await screen.findByRole("button", {
      name: "Acknowledge failure and enable fresh input",
    });
    let confirm!: () => void;
    f.api.transferTerminalInputControl.mockImplementationOnce(async (_session, _id, body) => {
      await new Promise<void>((resolve) => {
        confirm = resolve;
      });
      return {
        controller: "human",
        revision: String(BigInt(body.expected_revision) + 1n),
        frozen: false,
        in_flight: false,
      };
    });
    acknowledge.focus();
    fireEvent.click(acknowledge);
    await waitFor(() => expect(acknowledge.hasAttribute("disabled")).toBe(true));
    await act(async () => renderer.keyboard?.("premature\r"));
    expect(f.api.inputControlledTerminal).toHaveBeenCalledOnce();
    await act(async () => confirm());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Acknowledge failure and enable fresh input" }),
      ).toBeNull(),
    );
    expect(renderer.options.disableStdin).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Interactive terminal" }).querySelector("textarea"),
    );
    await act(async () => renderer.keyboard?.("fresh\r"));
    expect(f.api.transferTerminalInputControl).toHaveBeenCalledOnce();
    expect(f.api.inputControlledTerminal).toHaveBeenCalledTimes(2);
    expect(f.api.inputControlledTerminal.mock.calls[1][2]).toMatchObject({
      expected_revision: "2",
      bytes: Array.from(new TextEncoder().encode("fresh\r")),
    });
    expect(f.api.attachUserTerminal).toHaveBeenCalledOnce();
  });
});
