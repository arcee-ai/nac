import type { APIRequestContext, Page } from "@playwright/test";

import { createDirectSession, expect, test, waitForRunIdle, type EmbeddedHarness } from "./harness";
import { ScriptGate } from "./scripted-provider";

const CONTINUATION = "Continue autonomously pursuing this durable goal";
/** Control text NAC wraps around the objective for the model only. */
const INTERNAL_TEXT = [
  "Use get_goal",
  "nac_goal_continuation",
  CONTINUATION,
  "No token budget was set",
  "[durable goal continuation]",
];

async function storedGoal(request: APIRequestContext, harness: EmbeddedHarness, sessionId: string) {
  const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    goal_id: string;
    objective: string;
    status: string;
    token_budget: number | null;
  } | null;
}

async function expectNoInternalText(page: Page) {
  for (const text of INTERNAL_TEXT) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  }
}

async function capture(page: Page, name: string) {
  const directory = process.env.ALL556_EVIDENCE_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

test("shows the actual goal objective from the composer through continuation and reload", async ({
  harness,
  page,
  request,
}) => {
  const second = new ScriptGate();
  harness.provider.enqueue(
    "goal-first-run",
    { token: CONTINUATION },
    { kind: "text", text: "first goal step done", stream: true },
  );
  harness.provider.enqueue(
    "goal-second-run",
    { token: CONTINUATION, afterStep: "goal-first-run" },
    { kind: "text", text: "second goal step done", stream: true },
    second,
  );
  const sessionId = await createDirectSession(request, harness);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);

  await page.getByRole("button", { name: "Set durable goal" }).click();
  const budgetSwitch = page.getByRole("switch", { name: "Token budget" });
  await expect(budgetSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("No token limit")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Token budget amount" })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Token budget slider" })).toHaveCount(0);

  const objective = "Ship the embedded goal MVP\nwith the objective visible in the transcript";
  await page.getByRole("textbox", { name: "Goal objective" }).fill(objective);
  await capture(page, "after-1-new-goal-editor");
  const created = page.waitForResponse(
    (entry) =>
      entry.url().endsWith(`/sessions/${sessionId}/goal`) && entry.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create goal" }).click();
  const creation = await created;
  expect(creation.status()).toBe(201);
  expect(creation.request().postDataJSON()).toStrictEqual({ objective: objective });
  expect(((await creation.json()) as { token_budget: number | null }).token_budget).toBeNull();

  // The first run settles and NAC admits the next continuation of the goal.
  await second.accepted;
  const started = page.getByRole("region", { name: "Goal started" });
  const continued = page.getByRole("region", { name: "Goal continued" });
  await expect(started).toContainText("Ship the embedded goal MVP");
  await expect(started).toContainText("with the objective visible in the transcript");
  await expect(started).toContainText("Active");
  await expect(continued).toContainText("Ship the embedded goal MVP");
  await expectNoInternalText(page);
  const providerBody = JSON.stringify(harness.provider.requests[0]?.body);
  expect(providerBody).toContain("Use get_goal");
  expect(providerBody).toContain("Ship the embedded goal MVP");
  await started.scrollIntoViewIfNeeded();
  await capture(page, "after-3-transcript-continuation");

  await page.reload();
  await expect(started).toContainText("Ship the embedded goal MVP");
  await expect(continued).toContainText("with the objective visible in the transcript");
  await expectNoInternalText(page);
  await capture(page, "after-4-after-reload");

  // An explicit stop pauses the goal, so releasing the held run starts nothing.
  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  second.release();
  await expect
    .poll(async () => (await storedGoal(request, harness, sessionId))?.status)
    .toBe("paused");
  await expect(started).toContainText("Paused");
  harness.provider.assertConsumed();
});

test("shows a /goal objective and keeps a custom budget above the slider", async ({
  harness,
  page,
  request,
}) => {
  const first = new ScriptGate();
  harness.provider.enqueue(
    "slash-goal-run",
    { token: CONTINUATION },
    { kind: "text", text: "slash goal step done", stream: true },
    first,
  );
  const sessionId = await createDirectSession(request, harness);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("/goal Audit the release checklist");
  await composer.press("Enter");
  await first.accepted;
  const started = page.getByRole("region", { name: "Goal started" });
  await expect(started).toContainText("Audit the release checklist");
  await expectNoInternalText(page);
  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  first.release();
  await expect
    .poll(async () => (await storedGoal(request, harness, sessionId))?.status)
    .toBe("paused");

  await page.getByRole("button", { name: "Edit goal: Paused" }).click();
  await page.getByRole("switch", { name: "Token budget" }).click();
  await expect(page.getByText(/total billable tokens all of this goal's runs/)).toBeVisible();
  await page.getByRole("textbox", { name: "Token budget amount" }).fill("2500000");
  await expect(page.getByText(/above the slider's range and kept as entered/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Token budget slider" })).toHaveAttribute(
    "aria-valuenow",
    "1000000",
  );
  await capture(page, "after-5-custom-budget");
  const budgetSaved = page.waitForResponse(
    (entry) =>
      entry.url().includes(`/sessions/${sessionId}/goal/`) && entry.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await budgetSaved).ok()).toBe(true);
  expect((await storedGoal(request, harness, sessionId))?.token_budget).toBe(2_500_000);

  // Reload, then edit only the objective: the stored budget survives untouched.
  await page.reload();
  await page.getByRole("button", { name: "Edit goal: Paused" }).click();
  await expect(page.getByRole("textbox", { name: "Token budget amount" })).toHaveValue("2500000");
  await page
    .getByRole("textbox", { name: "Goal objective" })
    .fill("Audit the release checklist and its notes");
  const objectiveSaved = page.waitForRequest(
    (entry) => entry.url().includes(`/sessions/${sessionId}/goal/`) && entry.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await objectiveSaved).postDataJSON()).not.toHaveProperty("token_budget");
  await expect
    .poll(async () => await storedGoal(request, harness, sessionId))
    .toMatchObject({
      objective: "Audit the release checklist and its notes",
      token_budget: 2_500_000,
      status: "paused",
    });
  harness.provider.assertConsumed();
});
