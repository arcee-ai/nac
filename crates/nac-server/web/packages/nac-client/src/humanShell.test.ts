import { describe, expect, it } from "vitest";
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
