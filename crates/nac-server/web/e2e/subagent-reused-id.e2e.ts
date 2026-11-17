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

test("retains each foreground invocation when provider call IDs are reused", async ({
  harness,
  page,
  request,
}) => {
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
      callId: "continue-launch",
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
    { functionOutputCallId: "continue-launch", afterStep: "continue-child" },
    { kind: "text", text: "parent continued the same subagent", stream: "request" },
  );
  await parentTurn(request, harness, parentId, "E2E_CONTINUE_PARENT_SECOND", "continue-answer");
  const [continued] = await children(request, harness, parentId);
  expect(continued).toMatchObject({
    child_session_id: childId,
    generation: 2,
    status: "completed",
    report: "second child pass finished",
  });
  const result = await request.get(
    `${harness.baseUrl}/sessions/${parentId}/tool-calls/continue-launch`,
  );
  expect(result.status()).toBe(404);
  expect(await result.text()).toContain("tool call not found");
  for (let visit = 0; visit < 2; visit += 1) {
    if (visit === 0) await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
    else await page.reload();
    await expect(page.getByText("parent continued the same subagent")).toBeVisible();
    const disclosures = page.getByText("Invocation result", { exact: true });
    await expect(disclosures).toHaveCount(2);
    await disclosures.nth(0).click();
    await expect(disclosures.nth(0).locator("..")).toContainText("first child pass finished");
    await expect(disclosures.nth(0).locator("..")).not.toContainText("second child pass finished");
    await disclosures.nth(1).click();
    await expect(disclosures.nth(1).locator("..")).toContainText("second child pass finished");
    await expect(disclosures.nth(1).locator("..")).not.toContainText("first child pass finished");
  }
});
