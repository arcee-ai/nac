import { describe, expect, it, vi } from "vitest";
import { createNacApi } from "./api.js";
import { createNacClient } from "./nacClient.js";
import { bindExecutionInput, createExecutionConnection } from "./executionApi.js";
import type { ExecutionFrameResponse, ExecutionStatus } from "./types.js";

const source: ExecutionStatus = {
  id: "execution/instance",
  origin: "human_command",
  representation: "log",
  cwd: "/workspace",
  backend: "local",
  request_id: "exact-request",
  alive: true,
  process_state: "running",
  output_complete: false,
  input: false,
  resize: false,
  stop: true,
  retained: false,
  cols: 0,
  rows: 0,
};
const terminal = {
  protocol_version: 1,
  terminal_id: source.id,
  cols: 0,
  rows: 0,
  alive: true,
  output_complete: false,
};

describe("existing execution observation", () => {
  it("uses the consumer endpoint and exact ACK/reset cursors without launching or typing", async () => {
    const start = "9007199254740993";
    const end = "9007199254740994";
    const frames: ExecutionFrameResponse[] = [
      {
        protocol_version: 1,
        observer_id: "observer",
        terminal,
        execution: source,
        bytes: [],
        offset: start,
        next_offset: start,
        retained_start: start,
        retained_end: end,
        gap: true,
        caught_up: false,
        requires_ack: true,
        segments: [],
      },
      {
        protocol_version: 1,
        observer_id: "observer",
        terminal,
        execution: source,
        bytes: [65],
        offset: start,
        next_offset: end,
        retained_start: start,
        retained_end: end,
        gap: false,
        caught_up: true,
        requires_ack: true,
        segments: [
          {
            stream: "stdout",
            sequence: "18446744073709551615",
            combined_start: start,
            combined_end: end,
            stream_start: "0",
            stream_end: "1",
          },
        ],
      },
    ];
    const calls: { path: string; method: string; body: unknown }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const path = String(input);
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path.endsWith("/executions"))
        return Response.json({ protocol_version: 1, executions: [source] });
      if (path.endsWith("/observers"))
        return Response.json({
          protocol_version: 1,
          observer_id: "observer",
          idle_expiry_ms: 30_000,
          terminal,
        });
      if (path.endsWith("/read")) return Response.json(frames.shift());
      return new Response(null, { status: 204 });
    });
    const api = createNacApi(
      createNacClient({ endpoint: "https://example.test/prefix", credentials: "omit", fetch }),
    );
    expect((await api.listExecutions("session/id")).executions[0]).toEqual(source);
    const renderer = { reset: vi.fn(async () => {}), write: vi.fn(async () => {}) };
    const connection = createExecutionConnection(api, "session/id", source, renderer);
    await connection.attach();
    await connection.readNext();
    await connection.readNext();
    expect(renderer.reset).toHaveBeenCalledWith("gap", expect.any(AbortSignal));
    expect(renderer.write).toHaveBeenCalledWith(Uint8Array.of(65), expect.any(AbortSignal));
    expect(calls.filter((call) => call.path.endsWith("/read"))[1].body).toMatchObject({
      acknowledge_offset: start,
      acknowledge_reset: true,
    });
    await expect(connection.input(Uint8Array.of(13))).rejects.toThrow();
    await expect(connection.resize(80, 24)).rejects.toThrow("read-only");
    await connection.detach();
    expect(
      calls.every((call) =>
        call.path.startsWith("https://example.test/prefix/sessions/session%2Fid/executions"),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.path.endsWith("/input") ||
          call.path.endsWith("/stop") ||
          call.path.includes("user-terminals"),
      ),
    ).toBe(false);
    await api.stopExecution("session/id", source.id);
    expect(calls.at(-1)?.path).toBe(
      "https://example.test/prefix/sessions/session%2Fid/executions/execution%2Finstance/stop",
    );
    expect(calls.at(-1)?.method).toBe("POST");
  });
  it("binds literal human input to current retained-agent ownership despite stale frame liveness", async () => {
    const api = {
      inputUserTerminal: vi.fn(async () => {}),
      inputControlledTerminal: vi.fn(async () => ({ outcome: "written" as const, error: null })),
    };
    const retained = {
      ...source,
      origin: "agent" as const,
      representation: "pty" as const,
      retained: true,
      alive: false,
    };
    const human = bindExecutionInput(api, retained, {
      controller: "human",
      revision: "9007199254740993",
      frozen: false,
    });
    const bytes = Array.from(new TextEncoder().encode("π<RET>\r"));
    await human("session/id", retained.id, { protocol_version: 1, bytes });
    expect(api.inputControlledTerminal).toHaveBeenCalledWith(
      "session/id",
      retained.id,
      { protocol_version: 1, expected_revision: "9007199254740993", bytes },
      undefined,
    );
    expect(api.inputUserTerminal).not.toHaveBeenCalled();
    for (const control of [
      null,
      { controller: "agent" as const, revision: "2", frozen: false },
      { controller: "human" as const, revision: "3", frozen: true },
    ]) {
      await expect(
        bindExecutionInput(api, retained, control)("session", retained.id, {
          protocol_version: 1,
          bytes,
        }),
      ).rejects.toThrow("read-only");
    }
    await expect(
      bindExecutionInput(
        api,
        retained,
        { controller: "human", revision: "4", frozen: false },
        true,
      )("session", retained.id, { protocol_version: 1, bytes }),
    ).rejects.toThrow("read-only");
    expect(api.inputControlledTerminal).toHaveBeenCalledOnce();
  });
});
