import { expect, it } from "vitest";
import { presentToolCall } from "./toolPresentation";

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
