import { describe, expect, it, vi } from "vitest";
import { createNacApi } from "./api.js";
import { createNacClient } from "./nacClient.js";

describe("read-only bounded execution history", () => {
  it("uses the bound endpoint and one non-recovering GET without command lookup or output routes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        protocol_version: 1,
        history: { entries: [], limit: 32, older_entries_omitted: false },
      }),
    );
    const api = createNacApi(
      createNacClient({ endpoint: "https://history.example/api", credentials: "omit", fetch }),
    );
    expect((await api.listExecutionHistory("session /private")).history.entries).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://history.example/api/sessions/session%20%2Fprivate/executions/history",
    );
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("preserves caller cancellation instead of retrying an unavailable source", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const api = createNacApi(
      createNacClient({ endpoint: "https://history.example", credentials: "omit", fetch }),
    );
    const cancellation = new AbortController();
    const result = api.listExecutionHistory("session", cancellation.signal);
    const aborted = expect(result).rejects.toBeTruthy();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    cancellation.abort(new Error("view changed"));
    await aborted;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
