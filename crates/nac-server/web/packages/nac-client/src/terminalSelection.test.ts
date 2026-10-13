import { describe, expect, it, vi } from "vitest";
import { createNacClient } from "./nacClient.js";
import { createNacApi } from "./api.js";
import { TerminalProtocolError } from "./userTerminalConnection.js";
import type {
  TerminalSelectionSubmissionRequest,
  TerminalSelectionSubmissionResponse,
  TerminalSelectionPreviewResponse,
} from "./types.js";

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

const submissionBody: TerminalSelectionSubmissionRequest = {
  protocol_version: 1,
  admission_id: "3e2d94a0-341f-4efd-a1eb-dd5c1a528461",
  capture_id: capture,
  expected_owner_instance_id: "8e7e0592-8f76-4bcd-9071-9c6e1c50e01f",
  original_selected_text: " /compact\n$skill\nsec\0ret ",
  expected_selection_text: " /compact\n$skill\n[REDACTED] ",
  original_user_text: " user\r\n$skill ",
  expected_user_text: " user\n$skill ",
  delivery: "queue",
};
function admission(
  overrides: Partial<TerminalSelectionSubmissionResponse> = {},
): TerminalSelectionSubmissionResponse {
  return {
    protocol_version: 1,
    admission_id: submissionBody.admission_id,
    replayed: false,
    inbox_id: "9007199254740993",
    status: "pending",
    version: 0,
    current_delivery: "queue",
    current_target_run_id: null,
    delivered_run_id: null,
    accepted_intent: {
      protocol_version: 1,
      source_kind: "user_supplied_rendered_selection",
      admission_id: submissionBody.admission_id,
      capture_id: capture,
      source_session_id: "source/id",
      terminal_id: "shell/id",
      owner_instance_id: submissionBody.expected_owner_instance_id,
      client_capture_time_ms: null,
      text: submissionBody.expected_selection_text,
      user_text: submissionBody.expected_user_text,
      initial_delivery: "queue",
      initial_expected_run_id: null,
    },
    ...overrides,
  };
}
it("keeps exact frozen originals and immutable identity through explicit manual reconciliation, without automatic retry", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("lost admission ACK"))
    .mockResolvedValueOnce(
      Response.json(
        admission({ replayed: true, status: "cancelled", version: 2, current_delivery: "steer" }),
      ),
    );
  const api = createNacApi(
    createNacClient({ endpoint: "https://nac.example/prefix", credentials: "omit", fetch }),
  );
  const signal = new AbortController().signal;
  await expect(
    api.submitUserTerminalSelection("source/id", "shell/id", submissionBody, signal),
  ).rejects.toThrow("lost admission ACK");
  expect(fetch).toHaveBeenCalledTimes(1);
  const receipt = await api.submitUserTerminalSelection(
    "source/id",
    "shell/id",
    submissionBody,
    signal,
  );
  expect(receipt.status).toBe("cancelled");
  expect(receipt.accepted_intent.initial_delivery).toBe("queue");
  expect(receipt.current_delivery).toBe("steer");
  expect(receipt.inbox_id).toBe("9007199254740993");
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [path, init] of fetch.mock.calls) {
    expect(path).toBe(
      "https://nac.example/prefix/sessions/source%2Fid/user-terminals/shell%2Fid/selection-submissions",
    );
    expect(init?.signal).toBe(signal);
    expect(init?.credentials).toBe("omit");
    expect(JSON.parse(String(init?.body))).toEqual(submissionBody);
  }
});
it.each([
  { protocol_version: 2 },
  { source_kind: "log_range" },
  { source_session_id: "other" },
  { owner_instance_id: "other" },
  { capture_id: "other" },
  { client_capture_time_ms: "1" },
  { text: "changed" },
  { user_text: "changed" },
  { initial_delivery: "send" },
])("rejects mismatched durable canonical intent %j", async (invalid) => {
  const good = admission();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ ...good, accepted_intent: { ...good.accepted_intent, ...invalid } }),
  );
  const api = createNacApi(createNacClient({ fetch }));
  await expect(
    api.submitUserTerminalSelection("source/id", "shell/id", submissionBody),
  ).rejects.toBeInstanceOf(TerminalProtocolError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("binds normalized decimal capture-time claims without number precision loss", async () => {
  const claim = "0009007199254740993";
  const good = admission();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({
      ...good,
      accepted_intent: { ...good.accepted_intent, client_capture_time_ms: "9007199254740993" },
    }),
  );
  const api = createNacApi(createNacClient({ fetch }));
  const receipt = await api.submitUserTerminalSelection("source/id", "shell/id", {
    ...submissionBody,
    client_capture_time_ms: claim,
  });
  expect(receipt.accepted_intent.client_capture_time_ms).toBe("9007199254740993");
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).client_capture_time_ms).toBe(claim);
});
