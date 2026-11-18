import type { APIRequestContext } from "@playwright/test";

import { createDirectSession, expect, type EmbeddedHarness, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

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
  await expect(page.getByText(/Subagent · Start · Outcome unavailable/)).toBeVisible();
  await expect(page.getByText(/Subagent · Continue · Outcome unavailable/)).toBeVisible();
  const invocationResults = page.getByText("Invocation result", { exact: true });
  await invocationResults.nth(0).click();
  await expect(invocationResults.nth(0).locator("..")).toContainText("first child pass finished");
  await expect(invocationResults.nth(0).locator("..")).not.toContainText("child_session_id");
  await invocationResults.nth(0).locator("..").getByText("Show retained result").click();
  await expect(invocationResults.nth(0).locator("..")).toContainText("child_session_id");
  await invocationResults.nth(0).locator("..").getByText("Show retained result").click();
  await invocationResults.nth(1).click();
  await expect(invocationResults.nth(1).locator("..")).toContainText("second child pass finished");
  await expect(page.getByRole("button", { name: "Open Subagent in Subagents" })).toHaveCount(2);
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
  const mismatchTurn = page
    .locator("[data-turn]")
    .filter({ hasText: "parent read the label guidance" });
  await expect(mismatchTurn.getByText(/Subagent · Continue · Outcome unavailable/)).toBeVisible();
  await mismatchTurn.getByText("Invocation result", { exact: true }).click();
  await expect(mismatchTurn.getByText(/traditional child description is immutable/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("parent-mismatch.png"), fullPage: true });
  await page.goto(`${harness.baseUrl}/#/session/${childId}/insights`);
  await expect(page.getByText("second child pass finished")).toBeVisible();
  await expect(page.getByText("first child pass finished")).toBeVisible();
});

test("groups adjacent continuations for one child in both transcript densities", async ({
  harness,
  page,
  request,
}, testInfo) => {
  harness.provider.enqueue(
    "group-seed",
    { token: "E2E_GROUP_SEED" },
    {
      kind: "function_call",
      name: "subagent",
      callId: "group-seed-call",
      arguments: {
        profile: "general",
        description: label,
        prompt: "E2E_GROUP_CHILD_SEED",
        child_session_id: null,
        background: false,
      },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "group-seed-child",
    { token: "E2E_GROUP_CHILD_SEED", forbiddenTools: ["subagent"] },
    { kind: "text", text: "seed complete", stream: "request" },
  );
  harness.provider.enqueue(
    "group-seed-answer",
    { functionOutputCallId: "group-seed-call" },
    { kind: "text", text: "seed acknowledged", stream: "request" },
  );
  const parentId = await createDirectSession(request, harness);
  await parentTurn(request, harness, parentId, "E2E_GROUP_SEED", "group-seed-answer");
  const [child] = await children(request, harness, parentId);
  const secondGate = new ScriptGate();
  const answerGate = new ScriptGate();
  harness.provider.enqueue(
    "group-first",
    { token: "E2E_GROUP_PARENT" },
    {
      kind: "function_call",
      name: "subagent",
      callId: "group-first-call",
      arguments: {
        profile: "general",
        child_session_id: child.child_session_id,
        prompt: "E2E_GROUP_CHILD_FIRST",
        background: false,
      },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "group-first-child",
    { token: "E2E_GROUP_CHILD_FIRST", forbiddenTools: ["subagent"] },
    { kind: "text", text: "group first report", stream: "request" },
  );
  harness.provider.enqueue(
    "group-second",
    { functionOutputCallId: "group-first-call", afterStep: "group-first-child" },
    {
      kind: "function_call",
      name: "subagent",
      callId: "group-second-call",
      arguments: {
        profile: "general",
        child_session_id: child.child_session_id,
        prompt: "E2E_GROUP_CHILD_SECOND",
        background: false,
      },
      stream: "request",
    },
    secondGate,
  );
  harness.provider.enqueue(
    "group-second-child",
    { token: "E2E_GROUP_CHILD_SECOND", forbiddenTools: ["subagent"] },
    { kind: "text", text: "group second report", stream: "request" },
  );
  harness.provider.enqueue(
    "group-answer",
    { functionOutputCallId: "group-second-call", afterStep: "group-second-child" },
    {
      kind: "text",
      text: "grouped parent answer",
      reasoning: "Compared the two child reports before answering.",
      stream: "request",
    },
    answerGate,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
  const run = await request.post(`${harness.baseUrl}/sessions/${parentId}/runs`, {
    data: { prompt: "E2E_GROUP_PARENT" },
  });
  expect(run.status()).toBe(202);
  try {
    await secondGate.accepted;
    const liveTurn = page.locator("[data-turn]").last();
    const control = liveTurn.getByRole("button", { name: "Open Subagent in Subagents" });
    await expect(control).toBeVisible();
    await control.focus();
    secondGate.release();
    await answerGate.accepted;
    await expect(liveTurn.getByText("Invocation result", { exact: true })).toHaveCount(2);
    await expect(control).toBeFocused();
    answerGate.release();
    await waitForRunIdle(request, harness, parentId);
    harness.provider.assertConsumed();
  } finally {
    secondGate.release();
    answerGate.release();
  }

  await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
  for (const density of ["compact", "detailed"] as const) {
    await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
    await page.evaluate((value) => localStorage.setItem("nac.transcriptDensity", value), density);
    await page.reload();
    const turn = page.locator("[data-turn]").filter({ hasText: "grouped parent answer" });
    await expect(turn).toBeVisible();
    const target = turn.getByRole("button", { name: "Open Subagent in Subagents" });
    await expect(target).toHaveCount(1);
    const results = turn.getByText("Invocation result", { exact: true });
    await expect(results).toHaveCount(2);
    await results.nth(0).click();
    await expect(results.nth(0).locator("..")).toContainText("group first report");
    await results.nth(1).click();
    await expect(results.nth(1).locator("..")).toContainText("group second report");
    await expect(results.nth(0).locator("..")).toContainText("Generation 2");
    await expect(results.nth(1).locator("..")).toContainText("Generation 3");
    // Keep one result open in the matched screenshots so the group, the
    // second result control, and the density-controlled activity all fit.
    await results.nth(1).click();
    const prompt = page.getByText("E2E_GROUP_PARENT", { exact: true }).last();
    await prompt.evaluate((element) => {
      element.scrollIntoView({ block: "start" });
      for (
        let node: typeof element | null = element.parentElement;
        node;
        node = node.parentElement
      ) {
        if (node.scrollHeight > node.clientHeight && node.scrollTop > 0) {
          node.scrollTop = Math.max(0, node.scrollTop - 80);
          break;
        }
      }
    });
    await expect(prompt).toBeInViewport();
    await expect(target).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`group-${density}.png`) });
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(parentId));
    await expect(page.getByRole("tab", { name: "Subagents" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("group second report", { exact: true }).last()).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
  await page.reload();
  const mobileTurn = page.locator("[data-turn]").filter({ hasText: "grouped parent answer" });
  const mobileTarget = mobileTurn.getByRole("button", { name: "Open Subagent in Subagents" });
  await expect(mobileTarget).toHaveCount(1);
  await mobileTarget.scrollIntoViewIfNeeded();
  await mobileTarget.focus();
  await page.screenshot({ path: testInfo.outputPath("group-mobile.png") });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Subagents" })).toBeVisible();
});
