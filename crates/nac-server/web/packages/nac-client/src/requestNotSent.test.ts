import { expect, it, vi } from "vitest";
import { ApiError, NacClient, NacRequestNotSentError } from "./nacClient.js";

it("preserves the actual trusted adapter's before-send cause and request identity", async () => {
  const cause = new Error("Trusted browser adapter refused before dispatch");
  const error = new NacRequestNotSentError(cause);
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
  const client = new NacClient({ fetch, requestId: () => "request" });
  const result = await client.transport.admit("POST", "/sessions");
  expect(result).toEqual({
    status: "not-sent",
    requestId: "request",
    reason: "adapter-not-sent",
    error,
  });
  expect(error.cause).toBe(cause);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([
  new TypeError("network failed"),
  new DOMException("aborted during fetch", "AbortError"),
  Object.assign(new Error("untrusted name"), { name: "NacRequestNotSentError" }),
])("keeps generic or name-shaped transport errors uncertain", async (error) => {
  const client = new NacClient({ fetch: vi.fn().mockRejectedValue(error) });
  expect(await client.transport.admit("POST", "/sessions")).toMatchObject({
    status: "uncertain",
    error,
  });
});

it("cannot classify a response decoder's before-send marker as a known no-send", async () => {
  const marker = new NacRequestNotSentError(new Error("decoder failure"));
  const client = new NacClient({
    fetch: vi.fn().mockResolvedValue(Response.json({ accepted: true })),
  });
  const result = await client.transport.admit("POST", "/sessions", {
    decodeJson: () => {
      throw marker;
    },
  });
  expect(result.status).toBe("uncertain");
  if (result.status !== "uncertain") throw new Error("Expected uncertainty");
  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as Error).cause).toBe(marker);
});

it("preserves HTTP rejection and an already aborted pre-dispatch signal", async () => {
  const rejected = new NacClient({
    fetch: vi.fn().mockResolvedValue(Response.json({}, { status: 403 })),
  });
  await expect(rejected.transport.admit("POST", "/sessions")).rejects.toBeInstanceOf(ApiError);
  const fetch = vi.fn();
  const stopped = new NacClient({ fetch });
  const result = await stopped.transport.admit("POST", "/sessions", {
    signal: AbortSignal.abort(),
  });
  expect(result).toMatchObject({ status: "not-sent", reason: "aborted" });
  expect(fetch).not.toHaveBeenCalled();
});
