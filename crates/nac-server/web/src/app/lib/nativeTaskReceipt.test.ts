import { expect, it } from "vitest";
import { indexToolEvents, presentToolCall } from "./toolPresentation";

const id = "38e19c14-37b7-4b7e-a687-a628529b088f";
function hint(name: string, navigation: string, sessionId = id) {
  return presentToolCall({
    call: { id: "launch", type: "function", function: { name, arguments: "{}" } },
    hasResult: true,
    resultHasImage: false,
    active: false,
    turnCancelled: false,
    resultText: JSON.stringify({
      navigation,
      launch: {
        session_id: sessionId,
        caller_session_id: "caller",
        project_id: "saved-project",
        request: { request_id: id, title: "Separate brief" },
      },
    }),
  }).launchedTask;
}
it("keeps only native exact session route receipt hints", () => {
  expect(hint("launch_task", `/session/${id}`)?.sessionId).toBe(id);
  expect(hint("task_launch_status", `/session/${id}`)?.sessionId).toBe(id);
  expect(hint("mcp__fake__launch_task", `/session/${id}`)).toBeUndefined();
  for (const route of [
    "https://example.test/",
    "javascript:alert(1)",
    `/session/${id}/../../settings`,
    `//example.test/${id}`,
  ]) {
    expect(hint("launch_task", route)).toBeUndefined();
  }
  expect(hint("launch_task", "/session/../settings", "../settings")).toBeUndefined();
});

const admissionError = "initial input admission failed: operation lease unavailable";
const readyReceipt = {
  navigation: `/session/${id}`,
  launch: {
    session_id: id,
    caller_session_id: "caller",
    project_id: "saved-project",
    phase: "ready",
    error: admissionError,
    request: { request_id: id, title: "Separate brief" },
  },
};

function errorPresentation(text: string, name = "launch_task") {
  return presentToolCall({
    call: { id: "launch", type: "function", function: { name, arguments: "{}" } },
    events: indexToolEvents([
      {
        type: "tool_call_finished",
        call_id: "launch",
        thread_name: null,
        name,
        content_preview: admissionError,
        is_error: true,
        completion_status: "error",
      },
    ]).get("launch"),
    hasResult: true,
    resultText: text,
    resultHasImage: false,
    active: false,
    turnCancelled: false,
  });
}

it("retains published task identity and truthful admission failure from an error finish", () => {
  const presentation = errorPresentation(JSON.stringify(readyReceipt));
  expect(presentation).toMatchObject({
    status: "error",
    statusLabel: "Failed",
    resultPreview: admissionError,
    launchedTask: {
      sessionId: id,
      callerId: "caller",
      projectId: "saved-project",
      title: "Separate brief",
    },
  });
});

it.each([
  ["non-native tool", "mcp__fake__launch_task", JSON.stringify(readyReceipt)],
  [
    "external URL",
    "launch_task",
    JSON.stringify({ ...readyReceipt, navigation: "https://example.test/" }),
  ],
  [
    "traversal URL",
    "launch_task",
    JSON.stringify({ ...readyReceipt, navigation: `/session/${id}/../../settings` }),
  ],
  [
    "mismatched URL",
    "launch_task",
    JSON.stringify({
      ...readyReceipt,
      navigation: "/session/00000000-0000-0000-0000-000000000000",
    }),
  ],
  [
    "invalid UUID",
    "launch_task",
    JSON.stringify({
      ...readyReceipt,
      navigation: "/session/../settings",
      launch: { ...readyReceipt.launch, session_id: "../settings" },
    }),
  ],
  [
    "invalid request UUID",
    "launch_task",
    JSON.stringify({
      ...readyReceipt,
      launch: {
        ...readyReceipt.launch,
        request: { ...readyReceipt.launch.request, request_id: "invalid" },
      },
    }),
  ],
  ["plain pre-publication error", "launch_task", "Error: project unavailable"],
  ["malformed result", "launch_task", "{invalid"],
])("withholds invalid identity on an error finish: %s", (_reason, name, text) => {
  const presentation = errorPresentation(text, name);
  expect(presentation.status).toBe("error");
  expect(presentation.launchedTask).toBeUndefined();
});
