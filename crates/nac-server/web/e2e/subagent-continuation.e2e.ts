import type { APIRequestContext } from "@playwright/test";

import { createDirectSession, expect, type EmbeddedHarness, test, waitForRunIdle } from "./harness";

const label = "Audit the store";

type ChildRecord = {
  child_session_id: string;
  description: string;
  generation: number;
  status: string;
  report: string | null;
};

/** The exact tool result the production loop returned to the model for one call. */
function functionOutput(harness: EmbeddedHarness, callId: string): string {
  for (const entry of harness.provider.requests) {
    const input = (entry.body as { input?: unknown }).input;
    if (!Array.isArray(input)) continue;
    for (const item of input as Array<Record<string, unknown>>) {
      if (item.type === "function_call_output" && item.call_id === callId) {
        return String(item.output);
      }
    }
  }
  throw new Error(`no function_call_output for ${callId}`);
}

async function parentTurn(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  parentId: string,
  prompt: string,
  finalStep: string,
) {
  const run = await request.post(`${harness.baseUrl}/sessions/${parentId}/runs`, {
    data: { prompt },
  });
  expect(run.status()).toBe(202);
  // Idle alone can be observed before the accepted run starts.
  await expect
    .poll(() => harness.provider.requests.some((entry) => entry.matchedStep === finalStep))
    .toBe(true);
  await waitForRunIdle(request, harness, parentId);
  harness.provider.assertConsumed();
}

async function children(request: APIRequestContext, harness: EmbeddedHarness, parentId: string) {
  const response = await request.get(`${harness.baseUrl}/sessions/${parentId}/children`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as ChildRecord[];
}

test("continues a subagent without repeating its label and explains a mismatch to the model", async ({
  harness,
  page,
  request,
}, testInfo) => {
  harness.provider.enqueue(
    "launch",
    { token: "E2E_CONTINUE_PARENT_LAUNCH", requiredTools: ["subagent"] },
    {
      kind: "function_call",
      name: "subagent",
      callId: "continue-launch",
      arguments: {
        profile: "general",
        description: label,
        prompt: "E2E_CONTINUE_CHILD_FIRST inspect the store",
        child_session_id: null,
        background: false,
      },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "launch-child",
    { token: "E2E_CONTINUE_CHILD_FIRST", forbiddenTools: ["subagent"] },
    { kind: "text", text: "first child pass finished", stream: "request" },
  );
  harness.provider.enqueue(
    "launch-answer",
    { functionOutputCallId: "continue-launch" },
    { kind: "text", text: "parent saw the launch", stream: "request" },
  );
  const parentId = await createDirectSession(request, harness);
  await parentTurn(request, harness, parentId, "E2E_CONTINUE_PARENT_LAUNCH", "launch-answer");
  const [launched] = await children(request, harness, parentId);
  expect(launched).toMatchObject({ description: label, generation: 1, status: "completed" });
  const childId = launched.child_session_id;

  // The model continues the child it owns without the description field.
  harness.provider.enqueue(
    "continue",
    { token: "E2E_CONTINUE_PARENT_SECOND", requiredTools: ["subagent"] },
    {
      kind: "function_call",
      name: "subagent",
      callId: "continue-second",
      arguments: {
        profile: "general",
        prompt: "E2E_CONTINUE_CHILD_SECOND recheck the locks",
        child_session_id: childId,
        background: false,
      },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "continue-child",
    { token: "E2E_CONTINUE_CHILD_SECOND", forbiddenTools: ["subagent"] },
    { kind: "text", text: "second child pass finished", stream: "request" },
  );
  harness.provider.enqueue(
    "continue-answer",
    { functionOutputCallId: "continue-second" },
    { kind: "text", text: "parent continued the same subagent", stream: "request" },
  );
  await parentTurn(request, harness, parentId, "E2E_CONTINUE_PARENT_SECOND", "continue-answer");
  const continued = JSON.parse(functionOutput(harness, "continue-second")) as ChildRecord;
  expect(continued).toMatchObject({
    child_session_id: childId,
    description: label,
    generation: 2,
    status: "completed",
    report: "second child pass finished",
  });
  await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
  await expect(page.getByText("parent continued the same subagent")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("parent-continuation.png"), fullPage: true });

  // A different label for the same child is refused before any child turn,
  // and the model is told how to retry.
  harness.provider.enqueue(
    "mismatch",
    { token: "E2E_CONTINUE_PARENT_MISMATCH", requiredTools: ["subagent"] },
    {
      kind: "function_call",
      name: "subagent",
      callId: "continue-mismatch",
      arguments: {
        profile: "general",
        description: "Rename the audit",
        prompt: "E2E_CONTINUE_CHILD_MISMATCH must never run",
        child_session_id: childId,
        background: false,
      },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "mismatch-answer",
    { functionOutputCallId: "continue-mismatch" },
    { kind: "text", text: "parent read the label guidance", stream: "request" },
  );
  await parentTurn(request, harness, parentId, "E2E_CONTINUE_PARENT_MISMATCH", "mismatch-answer");
  expect(functionOutput(harness, "continue-mismatch")).toBe(
    `Error: traditional child description is immutable (expected '${label}'). ` +
      `To continue or steer child '${childId}', omit description (or pass null) or pass ` +
      `'${label}' exactly; launch a new child with child_session_id null for a different task label`,
  );
  expect(harness.provider.requests.every((entry) => entry.matchedStep != null)).toBe(true);
  const after = await children(request, harness, parentId);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ child_session_id: childId, description: label, generation: 2 });

  await page.reload();
  await expect(page.getByText("parent read the label guidance")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("parent-mismatch.png"), fullPage: true });
  await page.goto(`${harness.baseUrl}/#/session/${childId}/insights`);
  await expect(page.getByText("second child pass finished")).toBeVisible();
  await expect(page.getByText("first child pass finished")).toBeVisible();
});
