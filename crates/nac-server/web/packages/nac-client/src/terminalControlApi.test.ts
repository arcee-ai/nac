import { describe, expect, it, vi } from "vitest";
import { createNacApi } from "./api.js";
import { createNacClient } from "./nacClient.js";
import { controlledTerminalInput } from "./terminalControlApi.js";
import {
  TerminalInputRejectedError,
  TerminalInputUncertainError,
  UserTerminalConnection,
} from "./userTerminalConnection.js";
import { UserTerminalInputPump } from "./userTerminalInputPump.js";

describe("terminal controller admission", () => {
  it("binds all packets to one revision and uses one request without retry", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ outcome: "written", error: null });
    });
    const api = createNacApi(
      createNacClient({ endpoint: "https://example.test/nac/v1", credentials: "omit", fetch }),
    );
    const input = controlledTerminalInput(api, "18446744073709551615");
    await input("session/id", "process/id", { protocol_version: 1, bytes: [60, 82, 69, 84, 62] });
    expect(requests).toEqual([
      {
        protocol_version: 1,
        expected_revision: "18446744073709551615",
        bytes: [60, 82, 69, 84, 62],
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes rejected queued bytes from accepted unconfirmed writes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ outcome: "rejected", error: "controller changed before write" }),
    );
    const api = createNacApi(
      createNacClient({ endpoint: "https://example.test/nac/v1", credentials: "omit", fetch }),
    );
    const connection = new UserTerminalConnection(
      { ...api, inputUserTerminal: controlledTerminalInput(api, "1") },
      "session",
      "process",
      { write: async () => {}, reset: async () => {} },
    );
    await expect(connection.input(Uint8Array.of(65))).rejects.toBeInstanceOf(
      TerminalInputRejectedError,
    );
    expect(connection.isInputUncertain).toBe(false);
    fetch.mockImplementationOnce(async () =>
      Response.json({ outcome: "unconfirmed", error: "writer receipt lost" }),
    );
    await expect(connection.input(Uint8Array.of(66))).rejects.toBeInstanceOf(
      TerminalInputUncertainError,
    );
    expect(connection.isInputUncertain).toBe(true);
    await expect(connection.input(Uint8Array.of(67))).rejects.toBeInstanceOf(
      TerminalInputUncertainError,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("discards a pump's future batch after a stale receipt without changing its revision", async () => {
    let reject: (reason: unknown) => void = () => {};
    const active = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const input = vi.fn(async () => active);
    const pump = new UserTerminalInputPump({ input, acknowledgeInputUncertainty: () => {} });
    const first = pump.send(Uint8Array.of(1));
    const pending = pump.send(Uint8Array.of(2));
    const firstCheck = expect(first).rejects.toThrow();
    const pendingCheck = expect(pending).rejects.toThrow();
    reject(new TerminalInputRejectedError("stale"));
    await Promise.all([firstCheck, pendingCheck]);
    expect(input).toHaveBeenCalledTimes(1);
    expect(pump.pendingBytes).toBe(0);
    pump.dispose();
  });
});
