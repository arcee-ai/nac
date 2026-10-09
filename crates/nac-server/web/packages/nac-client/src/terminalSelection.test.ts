import { describe, expect, it, vi } from "vitest";
import { createNacClient } from "./nacClient.js";
import { createNacApi } from "./api.js";
import { TerminalProtocolError } from "./userTerminalConnection.js";
import type { TerminalSelectionPreviewResponse } from "./types.js";

const capture = "2b4105a9-df4f-4f63-8e43-d5b994248370";
function response(
  overrides: Partial<TerminalSelectionPreviewResponse> = {},
): TerminalSelectionPreviewResponse {
  return {
    protocol_version: 1,
    capture_id: capture,
    source_kind: "user_supplied_rendered_selection",
    source_session_id: "source/id",
    terminal_id: "shell/id",
    owner_instance_id: "owner",
    previewed_at_ms: "1000",
    text: "/compact\n$skill\n[REDACTED]\n中🙂",
    input_utf8_bytes: 32,
    input_scalars: 27,
    text_utf8_bytes: 33,
    text_scalars: 28,
    controls_removed: 1,
    line_endings_normalized: 1,
    max_utf8_bytes: 32768,
    max_scalars: 8192,
    truncated: false,
    ...overrides,
  };
}

describe("source-bound terminal selection preview facade", () => {
  it("passes the frozen original literally through immutable consumer transport and creates only a preview request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response()));
    const api = createNacApi(
      createNacClient({
        endpoint: "https://nac.example/prefix",
        credentials: "omit",
        authorization: { kind: "bearer", token: "consumer-token" },
        headers: { "X-Consumer": "binding" },
        fetch,
      }),
    );
    const signal = new AbortController().signal;
    const frozenOriginal = "/compact\n$skill\nsec\0ret\r\n中🙂";
    const preview = await api.previewUserTerminalSelection(
      "source/id",
      "shell/id",
      {
        protocol_version: 1,
        capture_id: capture,
        selected_text: frozenOriginal,
      },
      signal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe(
      "https://nac.example/prefix/sessions/source%2Fid/user-terminals/shell%2Fid/selection-preview",
    );
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(init?.signal).toBe(signal);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer consumer-token");
    expect(headers.get("x-consumer")).toBe("binding");
    expect(JSON.parse(String(init?.body))).toEqual({
      protocol_version: 1,
      capture_id: capture,
      selected_text: frozenOriginal,
    });
    expect(preview.text).toBe(response().text);
    expect(frozenOriginal).toContain("sec\0ret"); // Canonical preview never mutates the frozen draft source.
  });

  it.each([
    { protocol_version: 2 },
    { source_session_id: "other" },
    { terminal_id: "other" },
    { capture_id: "other" },
    { source_kind: "log_range" },
    { truncated: true },
  ])("rejects incompatible or mismatched previews: %j", async (invalid) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(response(invalid as Partial<TerminalSelectionPreviewResponse>)),
    );
    const api = createNacApi(createNacClient({ fetch }));
    await expect(
      api.previewUserTerminalSelection("source/id", "shell/id", {
        protocol_version: 1,
        capture_id: capture,
        selected_text: "selected",
      }),
    ).rejects.toBeInstanceOf(TerminalProtocolError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry lost preview responses or submit agent input", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("lost preview response"));
    const api = createNacApi(createNacClient({ fetch }));
    await expect(
      api.previewUserTerminalSelection("source/id", "shell/id", {
        protocol_version: 1,
        capture_id: capture,
        selected_text: "selected",
      }),
    ).rejects.toThrow("lost preview response");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
