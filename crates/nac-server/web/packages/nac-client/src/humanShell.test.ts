import { describe, expect, it, vi } from "vitest";
import { createNacApi } from "./api.js";
import { createNacClient, UncertainCommandAdmissionError } from "./nacClient.js";

const command = { request_id: "human-request", command: "  printf exact\n", timeout_ms: 37 };
const result = {
  request_id: command.request_id,
  operation_id: "operation",
  command: command.command,
  timeout_ms: 37,
  state: "accepted",
  accepted_at_epoch_ms: 1,
  finished_at_epoch_ms: null,
  exit_code: null,
  stdout: "",
  stderr: "",
  diagnostic: null,
  output_id: null,
  transcript_index: null,
};
const json = () =>
  new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });

describe("human command admission", () => {
  it("freezes caller payload and uses the explicitly bound facade endpoint and credentials", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mutable = { ...command };
    let ready!: () => void;
    const headers = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const client = createNacClient({
      endpoint: "https://host.example/nac",
      credentials: "omit",
      headers: async () => {
        await headers;
        return { "X-Consumer": "bound" };
      },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return json();
      },
    });
    const pending = createNacApi(client).submitShellCommand("session /", mutable);
    mutable.request_id = "changed";
    mutable.command = "changed";
    ready();
    await pending;
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://host.example/nac/sessions/session%20%2F/user-commands");
    expect(calls[0].init.credentials).toBe("omit");
    expect(calls[0].init.headers).toMatchObject({ "x-consumer": "bound" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual(command);
  });
  it("does not dispatch or lookup after pre-dispatch cancellation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createNacClient({ fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.submitShellCommand("session", command, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects mismatched canonical identity without mistaking redacted display text for payload", async () => {
    const methods: string[] = [];
    const client = createNacClient({
      fetch: async (_url, init) => {
        methods.push(init!.method!);
        return Response.json({ ...result, request_id: "wrong", command: "[REDACTED]" });
      },
    });
    await expect(client.submitShellCommand("session", command)).rejects.toBeInstanceOf(
      UncertainCommandAdmissionError,
    );
    expect(methods).toEqual(["POST", "GET"]);
    const redacted = createNacClient({
      fetch: async () => Response.json({ ...result, command: "[REDACTED]" }),
    });
    expect((await redacted.submitShellCommand("session", command)).command).toBe("[REDACTED]");
  });
  it("sends the exact identified payload once", async () => {
    const calls: RequestInit[] = [];
    const client = createNacClient({
      fetch: async (_url, init) => {
        calls.push(init!);
        return json();
      },
    });
    expect(await client.submitShellCommand("session", command)).toEqual(result);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body as string)).toEqual(command);
  });
  it("looks up a lost response without repeating effects", async () => {
    const methods: string[] = [];
    const client = createNacClient({
      fetch: async (_url, init) => {
        methods.push(init!.method!);
        if (init!.method === "POST") throw new TypeError("response lost");
        return json();
      },
    });
    expect(await client.submitShellCommand("session", command)).toEqual(result);
    expect(methods).toEqual(["POST", "GET"]);
  });
  it("keeps unresolved admission unknown with its durable identity", async () => {
    const methods: string[] = [];
    const client = createNacClient({
      fetch: async (_url, init) => {
        methods.push(init!.method!);
        throw new TypeError("connection lost");
      },
    });
    const error = await client
      .submitShellCommand("session", command)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(UncertainCommandAdmissionError);
    expect((error as UncertainCommandAdmissionError).requestId).toBe(command.request_id);
    expect(methods).toEqual(["POST", "GET"]);
  });
});
