import fs from "node:fs/promises";
import path from "node:path";

import type { APIRequestContext } from "@playwright/test";

import { createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

type InboxItem = { id: number; origin?: string; status: string; version: number; prompt: string };

const PARENT = "E2E_ALL557_PARENT";
const HUMAN = "E2E_ALL557_HUMAN follow-up after the children";
const DONE = { a: "E2E_ALL557_CHILD_A_DONE", b: "E2E_ALL557_CHILD_B_DONE" };

function launch(child: "a" | "b") {
  return {
    profile: "general",
    description: `Background child ${child}`,
    prompt: `E2E_ALL557_CHILD_${child.toUpperCase()}_TASK`,
    child_session_id: null,
    background: true,
  };
}

async function inbox(request: APIRequestContext, baseUrl: string, sessionId: string) {
  const response = await request.get(`${baseUrl}/sessions/${sessionId}/inbox`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as InboxItem[];
}

async function transcript(request: APIRequestContext, baseUrl: string, sessionId: string) {
  const response = await request.get(`${baseUrl}/sessions/${sessionId}/messages?limit=200`);
  expect(response.ok()).toBe(true);
  return JSON.stringify(((await response.json()) as { messages: unknown[] }).messages);
}

function occurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

test("delivers background child results once without editable pending-message controls", async ({
  harness,
  page,
  request,
}) => {
  const provider = harness.provider;
  const parentTools = ["subagent"];
  provider.enqueue(
    "launch-a",
    { token: PARENT, requiredTools: parentTools },
    {
      kind: "function_call",
      name: "subagent",
      callId: "all557-a",
      arguments: launch("a"),
      stream: "request",
    },
  );
  provider.enqueue(
    "launch-b",
    { functionOutputCallId: "all557-a", requiredTools: parentTools, afterStep: "launch-a" },
    {
      kind: "function_call",
      name: "subagent",
      callId: "all557-b",
      arguments: launch("b"),
      stream: "request",
    },
  );
  // The parent stays inside its run while both children settle.
  const busy = new ScriptGate();
  provider.enqueue(
    "parent-busy",
    { functionOutputCallId: "all557-b", requiredTools: parentTools, afterStep: "launch-b" },
    { kind: "text", text: "E2E_ALL557_PARENT_WAITING", stream: true },
    busy,
  );
  for (const child of ["a", "b"] as const) {
    provider.enqueue(
      `child-${child}`,
      { token: `E2E_ALL557_CHILD_${child.toUpperCase()}_TASK`, forbiddenTools: parentTools },
      { kind: "text", text: DONE[child], stream: "request" },
    );
  }
  // Both results arrive at the run's next model boundary, before the person's
  // queued message starts its own successor run.
  provider.enqueue(
    "parent-results",
    { token: DONE.b, requiredTools: parentTools, afterStep: "parent-busy" },
    { kind: "text", text: "E2E_ALL557_PARENT_SAW_BOTH", stream: "request" },
  );
  provider.enqueue(
    "human-successor",
    { token: "E2E_ALL557_HUMAN", requiredTools: parentTools, afterStep: "parent-results" },
    { kind: "text", text: "E2E_ALL557_HUMAN_HANDLED", stream: "request" },
  );

  const parentId = await createSession(request, harness, "direct");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${harness.baseUrl}/#/session/${parentId}`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill(PARENT);
  await page
    .locator("form")
    .filter({ has: composer })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await busy.accepted;

  await expect
    .poll(
      async () => {
        const response = await request.get(`${harness.baseUrl}/sessions/${parentId}/children`);
        const children = (await response.json()) as { status: string }[];
        return children.map((child) => child.status).join(",");
      },
      { timeout: 20_000 },
    )
    .toBe("completed,completed");

  await composer.fill(HUMAN);
  await page.getByRole("button", { name: "Queue Next" }).click();
  const pending = page.getByLabel("Pending messages");
  await expect(pending).toContainText(HUMAN);
  const pendingItems = async () =>
    (await inbox(request, harness.baseUrl, parentId)).filter((item) => item.status === "pending");
  // Both results and the person's message are durably pending on any build.
  await expect.poll(async () => (await pendingItems()).length).toBe(3);
  // Let the composer's inbox poll observe all three before capturing evidence.
  await page.waitForTimeout(1_500);
  const evidenceDir = process.env.NAC_ALL557_EVIDENCE_DIR;
  if (evidenceDir) {
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(
        evidenceDir,
        `pending-messages-${process.env.NAC_ALL557_LABEL ?? "after"}.png`,
      ),
    });
  }
  expect((await pendingItems()).map((item) => item.origin)).toEqual([
    "traditional_child",
    "traditional_child",
    "input",
  ]);
  await expect(pending).not.toContainText("Traditional child completion");
  await expect(pending.getByRole("button", { name: "Change to steer" })).toHaveCount(1);
  await expect(pending.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(1);
  const results = page.getByRole("status", { name: "Pending subagent results" });
  await expect(results).toHaveText("2 subagent results pending");

  // The public routes refuse a delegated result; the person's item stays editable.
  const items = await inbox(request, harness.baseUrl, parentId);
  const internal = items.find((item) => item.origin === "traditional_child")!;
  for (const method of ["patch", "delete"] as const) {
    const refused = await request[method](
      `${harness.baseUrl}/sessions/${parentId}/inbox/${internal.id}`,
      {
        data:
          method === "patch"
            ? { expected_version: internal.version, delivery: "queue" }
            : { expected_version: internal.version },
      },
    );
    expect(refused.status()).toBe(409);
  }

  busy.release();
  await expect
    .poll(
      async () =>
        (await inbox(request, harness.baseUrl, parentId)).every(
          (item) => item.status === "delivered",
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await waitForRunIdle(request, harness, parentId);
  await expect(page.getByText("E2E_ALL557_HUMAN_HANDLED", { exact: true })).toBeVisible();
  await expect(pending).toHaveCount(0);
  await expect(results).toHaveCount(0);

  const assertDeliveredOnce = async () => {
    const messages = await transcript(request, harness.baseUrl, parentId);
    expect(occurrences(messages, DONE.a)).toBe(1);
    expect(occurrences(messages, DONE.b)).toBe(1);
    expect(occurrences(messages, "E2E_ALL557_HUMAN follow-up")).toBe(1);
  };
  await assertDeliveredOnce();

  await page.reload();
  await expect(page.getByText("E2E_ALL557_HUMAN_HANDLED", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E_ALL557_PARENT_SAW_BOTH", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Pending messages")).toHaveCount(0);
  await expect(results).toHaveCount(0);
  await assertDeliveredOnce();
  provider.assertConsumed();
});
