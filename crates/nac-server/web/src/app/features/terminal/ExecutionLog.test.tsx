/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type {
  ExecutionFrameResponse,
  ExecutionStatus,
} from "../../../../packages/nac-client/src/index";
import { ExecutionLog } from "./ExecutionLog";

const source: ExecutionStatus = {
  id: "opaque-pipe",
  origin: "agent",
  representation: "log",
  cwd: "/workspace",
  backend: "local",
  alive: true,
  process_state: "running",
  output_complete: false,
  input: false,
  resize: false,
  stop: true,
  retained: false,
  cols: 80,
  rows: 24,
};
const terminal = {
  protocol_version: 1,
  terminal_id: source.id,
  alive: true,
  output_complete: false,
  cols: 80,
  rows: 24,
};
const truncatedNotice =
  "Display limit reached. Showing the latest output; earlier text is hidden in this view.";
afterEach(cleanup);

function fixture() {
  let cursor = 0;
  const pending: Array<{
    resolve: (frame: ExecutionFrameResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  const api = {
    ...standaloneRuntime.api,
    attachExecution: vi.fn(async () => {
      cursor = 0;
      return { protocol_version: 1, observer_id: "observer", idle_expiry_ms: 30_000, terminal };
    }),
    pullExecution: vi.fn<typeof standaloneRuntime.api.pullExecution>(
      async (_session, _id, _observer, _body, signal) =>
        new Promise((resolve, reject) => {
          const read = { resolve, reject };
          pending.push(read);
          signal?.addEventListener(
            "abort",
            () => {
              const index = pending.indexOf(read);
              if (index >= 0) pending.splice(index, 1);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    ),
    detachExecution: vi.fn(async () => {}),
    stopExecution: vi.fn(),
  };
  const view = render(
    <RuntimeContext.Provider value={{ ...standaloneRuntime, api }}>
      <ExecutionLog sessionId="session" source={source} />
    </RuntimeContext.Provider>,
  );
  const page = async (text: string, options: { gap?: boolean; complete?: boolean } = {}) => {
    await waitFor(() => expect(pending).toHaveLength(1));
    const bytes = Array.from(new TextEncoder().encode(text));
    const offset = options.gap ? cursor + 1024 : cursor;
    cursor = offset + bytes.length;
    await act(async () =>
      pending.shift()!.resolve({
        protocol_version: 1,
        observer_id: "observer",
        terminal: { ...terminal, output_complete: options.complete ?? false },
        execution: source,
        segments: [],
        bytes,
        offset: String(offset),
        next_offset: String(cursor),
        retained_start: options.gap ? String(cursor) : "0",
        retained_end: String(cursor),
        gap: options.gap ?? false,
        caught_up: true,
        requires_ack: bytes.length > 0 || !!options.gap,
      }),
    );
  };
  const overflow = async () => {
    await page("x".repeat(32_768));
    await page("x".repeat(32_768));
    expect(screen.queryByText(truncatedNotice)).toBeNull();
    await page("y");
    await screen.findByText(truncatedNotice);
  };
  return { ...view, api, pending, page, overflow };
}

describe("execution log display loss", () => {
  it("reports the display cap independently of completed output and ACKs the full cursor", async () => {
    const f = fixture();
    await f.overflow();
    expect(screen.getByRole("region", { name: "Execution log" }).textContent).toBe(
      "x".repeat(65_535) + "y",
    );
    await f.page("", { complete: true });
    await screen.findByText("Output complete");
    expect(screen.getByText(truncatedNotice)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(f.api.pullExecution.mock.calls[3][3].acknowledge_offset).toBe("65537");
    f.unmount();
    await waitFor(() => expect(f.api.detachExecution).toHaveBeenCalledOnce());
    expect(f.api.stopExecution).not.toHaveBeenCalled();
  });

  it("clears the display notice on a server gap while preserving the separate gap warning", async () => {
    const f = fixture();
    await f.overflow();
    await f.page("", { gap: true });
    await screen.findByText("Earlier output was discarded. The log was reset before replay.");
    expect(screen.queryByText(truncatedNotice)).toBeNull();
    await f.page("retained tail");
    expect(screen.getByRole("region", { name: "Execution log" }).textContent).toBe("retained tail");
    expect(f.api.pullExecution.mock.calls[4][3]).toMatchObject({ acknowledge_reset: true });
  });

  it("keeps read failure separate and resets display loss when explicitly reconnecting", async () => {
    const f = fixture();
    await f.overflow();
    await waitFor(() => expect(f.pending).toHaveLength(1));
    await act(async () => f.pending.shift()!.reject(new Error("Observation unavailable")));
    await screen.findByText("Disconnected");
    expect(screen.getByRole("alert").textContent).toBe("Observation unavailable");
    expect(screen.getByText(truncatedNotice)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(f.api.attachExecution).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(truncatedNotice)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await f.page("fresh replay");
    expect(screen.getByRole("region", { name: "Execution log" }).textContent).toBe("fresh replay");
    expect(f.api.detachExecution).toHaveBeenCalledOnce();
    expect(f.api.stopExecution).not.toHaveBeenCalled();
  });
});
