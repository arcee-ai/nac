import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import type { TerminalSelectionSubmissionRequest } from "../packages/nac-client/dist/types.js";
import { createDirectSession, expect, test } from "./harness";
import { ScriptGate } from "./scripted-provider";

const evidence = "literal $skill /compact";
const accompanyingOriginal = " /goal literal\u0001\n$skill ";
const accompanyingCanonical = " /goal literal\n$skill ";
function octal(text: string) {
  return Array.from(
    new TextEncoder().encode(text),
    (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
  ).join("");
}

/** Mouse selection on the real xterm grid, using its accessible rendered rows.
 * No renderer object, synthetic capture callback or protocol byte sink is exposed.
 */
async function selectRenderedLine(page: Page, pane: Locator, cols: number, rows: number) {
  const lines = pane.locator(".xterm-accessibility-tree > div");
  const content = await lines.allTextContents();
  const row = content.findIndex((line) => line.trimEnd() === evidence);
  expect(row, `rendered output rows: ${JSON.stringify(content)}`).toBeGreaterThanOrEqual(0);
  const grid = await pane.locator(".xterm-screen").boundingBox();
  expect(grid).not.toBeNull();
  const cell = grid!.width / cols;
  const y = grid!.y + (row + 0.5) * (grid!.height / rows);
  await page.mouse.move(grid!.x + 0.25 * cell, y);
  await page.mouse.down();
  await page.mouse.move(grid!.x + (evidence.length + 0.25) * cell, y, { steps: 10 });
  await page.mouse.up();
  await pane.getByRole("button", { name: "Review selected text", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review terminal selection" });
  await expect(dialog.getByLabel("Reviewed selected text")).toHaveText(evidence);
  return dialog;
}

for (const mobile of [false, true]) {
  test(`real selected terminal evidence ${mobile ? "mobile" : "desktop"} requires review and explicit same-intent Send`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const session = await createDirectSession(request, harness);
    const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
    await api.setPermissionApprovalMode(session, "auto_approve");
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else {
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      if (await show.isVisible()) await show.click();
    }
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    await pane.getByRole("button", { name: "New shell", exact: true }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    await pane.getByRole("button", { name: "Focus terminal" }).click();
    await page.keyboard.type(`printf '${octal(evidence + "\n")}'`);
    await page.keyboard.press("Enter");
    await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
    const shell = (await api.listUserTerminals(session)).terminals[0];
    const geometry = await api.getUserTerminal(session, shell.terminal_id);
    let dialog = await selectRenderedLine(page, pane, geometry.cols, geometry.rows);
    expect(harness.provider.requests).toHaveLength(0);
    expect(await api.listInbox(session)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await api.listInbox(session)).toHaveLength(0);
    dialog = await selectRenderedLine(page, pane, geometry.cols, geometry.rows);
    await dialog.getByRole("button", { name: "Edit accompanying text", exact: true }).click();
    await dialog.getByLabel("Accompanying literal text (optional)").fill(accompanyingOriginal);
    await expect(
      dialog.getByRole("button", { name: "Send selection", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Update preview", exact: true }).click();
    await expect(dialog.getByLabel("Reviewed accompanying text")).toHaveText(accompanyingCanonical);
    await api.terminateTerminal(session, shell.terminal_id);
    await expect(dialog.getByRole("status")).toContainText("source shell has exited");
    const submissions: TerminalSelectionSubmissionRequest[] = [];
    await page.route("**/selection-submissions", async (route) => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) {
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        await route.abort("failed"); // Only the local reply is lost, after the real durable commit.
      } else await route.continue();
    });
    harness.provider.enqueue(
      "selected-send",
      { token: evidence },
      { kind: "text", text: "selection accepted once", stream: true },
    );
    await page.screenshot({
      path: testInfo.outputPath(`selection-review-${mobile ? "mobile" : "desktop"}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Send selection", exact: true }).click();
    await expect(dialog).toContainText("Submission was not confirmed");
    await harness.provider.waitForRequestCount(1);
    await expect.poll(async () => (await api.getSession(session)).active_run == null).toBe(true);
    expect(harness.provider.requests).toHaveLength(1);
    expect(submissions).toHaveLength(1);
    await dialog.getByRole("button", { name: "Retry same submission", exact: true }).click();
    await expect(dialog).toContainText("Existing admission reconciled.");
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0].original_selected_text).toBe(evidence);
    expect(submissions[0].expected_selection_text).toBe(evidence);
    expect(submissions[0].original_user_text).toBe(accompanyingOriginal);
    expect(submissions[0].expected_user_text).toBe(accompanyingCanonical);
    await expect.poll(async () => (await api.listInbox(session))[0]?.status).toBe("delivered");
    expect(await api.listInbox(session)).toHaveLength(1);
    await expect.poll(async () => (await api.getSession(session)).active_run == null).toBe(true);
    expect(harness.provider.requests).toHaveLength(1);
    const delivered = JSON.stringify(harness.provider.requests[0].body);
    expect(delivered).toContain(evidence);
    const providerBody = harness.provider.requests[0].body as {
      input: Array<{ role?: string; content?: unknown }>;
    };
    const shared = providerBody.input.find(
      (item) =>
        item.role === "user" &&
        typeof item.content === "string" &&
        item.content.includes('"source_kind":"user_supplied_rendered_selection"'),
    )!;
    const content = shared.content as string;
    const envelope = JSON.parse(content.slice(content.indexOf("\n") + 1));
    expect(envelope.text).toBe(evidence);
    expect(envelope.user_text).toBe(accompanyingCanonical);
    expect(delivered).toContain("user_supplied_rendered_selection");
    expect(delivered).not.toContain("\\u0001");
    await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
    if (mobile)
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    harness.provider.assertConsumed();
  });
}

test("real selection offers explicit busy queue and exact displayed-run steer with literal delivery", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  await fs.writeFile(path.join(harness.runRoot, "workspace/selection.txt"), "ordinary file\n");
  const boundary = new ScriptGate();
  harness.provider.enqueue(
    "busy-start",
    { token: "SELECTION_BUSY_RUN" },
    {
      kind: "function_call",
      name: "read",
      callId: "selection-read",
      arguments: { path: "selection.txt" },
    },
    boundary,
  );
  harness.provider.enqueue(
    "steered",
    { functionOutputCallId: "selection-read", token: evidence },
    { kind: "text", text: "literal steer observed", stream: true },
  );
  harness.provider.enqueue(
    "queued",
    { afterStep: "steered", token: evidence },
    { kind: "text", text: "literal queue observed", stream: true },
  );
  await api.submitRun(session, "SELECTION_BUSY_RUN");
  await boundary.accepted;
  const active = (await api.getSession(session)).active_run!;
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Focus terminal" }).click();
  await page.keyboard.type(`printf '${octal(evidence + "\n")}'`);
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
  const shell = (await api.listUserTerminals(session)).terminals[0];
  const geometry = await api.getUserTerminal(session, shell.terminal_id);
  let dialog = await selectRenderedLine(page, pane, geometry.cols, geometry.rows);
  await expect(dialog.getByRole("radio", { name: /Send as a new turn/ })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: /Queue after/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Queue selection", exact: true }).click();
  await expect(dialog).toContainText("Selection admission accepted.");
  await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
  dialog = await selectRenderedLine(page, pane, geometry.cols, geometry.rows);
  await dialog.getByRole("radio", { name: /Steer the displayed active run/ }).check();
  await dialog.getByRole("button", { name: "Steer selected run", exact: true }).click();
  await expect(dialog).toContainText("Selection admission accepted.");
  const inbox = await api.listInbox(session);
  expect(inbox).toHaveLength(2);
  expect(inbox[0].delivery).toBe("queue");
  expect(inbox[1].delivery).toBe("steer");
  expect(inbox[1].target_run_id).toBe(active.run_id);
  expect(harness.provider.requests).toHaveLength(1);
  boundary.release();
  await harness.provider.waitForRequestCount(3);
  await expect
    .poll(async () => (await api.listInbox(session)).map((item) => item.status))
    .toEqual(["delivered", "delivered"]);
  for (const providerRequest of harness.provider.requests.slice(1)) {
    const body = JSON.stringify(providerRequest.body);
    expect(body).toContain(evidence);
    expect(body).toContain("user_supplied_rendered_selection");
  }
  await api.terminateTerminal(session, shell.terminal_id);
  harness.provider.assertConsumed();
});
