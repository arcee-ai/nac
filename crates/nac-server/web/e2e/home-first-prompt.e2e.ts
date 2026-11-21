import fs from "node:fs/promises";
import path from "node:path";
import { createProject, expect, test, waitForRunIdle } from "./harness";
import { homeComposer } from "./focus-embedded-helpers";
import { ScriptGate } from "./scripted-provider";
import { chooseFixtureComposerModel } from "./model-fixture";

test.use({ orchestration: "0" });

test("Home waits for the owning interactive stream before its first permission request", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const file = path.join(harness.runRoot, "first-prompt-read.txt");
  await fs.writeFile(file, "public fixture text");
  harness.provider.enqueue(
    "home-first-ask",
    { token: "HOME_FIRST_ASK" },
    {
      kind: "function_call",
      name: "read",
      callId: "home-first-read",
      arguments: { path: file },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "home-first-result",
    { functionOutputCallId: "home-first-read" },
    {
      kind: "text",
      text: "The first request waited for its human.",
      stream: "request",
    },
  );
  const gate = new ScriptGate();
  let session = "";
  let streamRequested = false;
  const runs: string[] = [];
  await page.route("**/sessions/*/events/stream*", async (route) => {
    session = new URL(route.request().url()).pathname.split("/")[2];
    streamRequested = true;
    await gate.waitForRelease();
    await route.continue();
  });
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      /\/sessions\/[^/]+\/runs$/.test(new URL(outgoing.url()).pathname)
    )
      runs.push(outgoing.postDataJSON().prompt);
  });
  await page.goto(`${harness.baseUrl}/#/project/${project}`);
  await chooseFixtureComposerModel(page);
  await homeComposer(page).fill("HOME_FIRST_ASK");
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect.poll(() => streamRequested).toBe(true);
  expect(runs).toEqual([]);
  expect(harness.provider.requests).toHaveLength(0);
  gate.release();
  await expect(
    page.getByRole("dialog", { name: "Permission required", exact: true }),
  ).toBeVisible();
  expect(runs).toEqual(["HOME_FIRST_ASK"]);
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${session}/permissions`)).json())
      .requests,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(
    page.getByText("The first request waited for its human.", { exact: true }),
  ).toBeVisible();
  await waitForRunIdle(request, harness, session);
  harness.provider.assertConsumed();
});
