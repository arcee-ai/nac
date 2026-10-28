import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import type {
  MessagesPageResponse,
  TerminalSelectionSubmissionRequest,
} from "../packages/nac-client/dist/types.js";
import { createDirectSession, expect, test } from "./harness";
import { ScriptGate } from "./scripted-provider";
import { reviewTerminalEvidence } from "./terminal-evidence";

const evidence = "literal $skill /compact";
const accompanyingOriginal = " /goal literal\u0001\n$skill ";
const accompanyingCanonical = " /goal literal\n$skill ";
function octal(text: string) {
  return Array.from(
    new TextEncoder().encode(text),
    (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
  ).join("");
}

/** Canonical refresh may cancel an older read before it returns a page. Only
 * that definite read cancellation permits another explicit Load older click.
 * A successful response must render correctly; never retry around lost cards.
 */
async function loadOlderAfterRefresh(page: Page): Promise<MessagesPageResponse> {
  const button = page.getByRole("button", { name: "Load older", exact: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(button).toBeEnabled();
    const requested = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        url.pathname.endsWith("/messages") &&
        url.searchParams.has("before")
      );
    });
    await button.click();
    const request = await requested;
    const response = await request.response();
    const failure = response ? await response.finished() : null;
    if (response && !failure) {
      expect(response.ok()).toBe(true);
      return (await response.json()) as MessagesPageResponse;
    }
    expect(request.failure()?.errorText).toBe("net::ERR_ABORTED");
  }
  throw new Error("Older message read was superseded by three canonical refreshes");
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
    await pane.getByRole("button", { name: /^New shell$/i }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
    await page.keyboard.type(`printf '${octal(evidence + "\n")}'`);
    await page.keyboard.press("Enter");
    await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
    const shell = (await api.listUserTerminals(session)).terminals[0];
    let dialog = await reviewTerminalEvidence(page, pane, evidence);
    expect(harness.provider.requests).toHaveLength(0);
    expect(await api.listInbox(session)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await api.listInbox(session)).toHaveLength(0);
    if (mobile) {
      const beforeResize = await api.getUserTerminal(session, shell.terminal_id);
      await page.setViewportSize({ width: 390, height: 1000 });
      await expect
        .poll(async () => (await api.getUserTerminal(session, shell.terminal_id)).rows)
        .not.toBe(beforeResize.rows);
    }
    dialog = await reviewTerminalEvidence(page, pane, evidence);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
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
    // The canonical/model evidence remains byte exact while normal chat uses a
    // passive attachment. Navigation/reload do not submit or observe a source.
    await page.goto(`${harness.baseUrl}/#/session/${session}`);
    if (mobile) {
      // The panel left a row open, whose screen leads back to its list first.
      const panel = page.getByRole("dialog");
      const list = panel.getByRole("button", { name: "Open list", exact: true });
      if (await list.isVisible()) await list.click();
      await panel.getByRole("button", { name: "Close", exact: true }).click();
    }
    const card = page.getByRole("region", { name: "Terminal selection", exact: true });
    await expect(card).toHaveCount(1);
    await expect(card.getByLabel("Attached terminal output")).toHaveText(evidence);
    expect(await card.getByLabel("Attached accompanying message").textContent()).toBe(
      accompanyingCanonical,
    );
    await card.getByText("Canonical message", { exact: true }).click();
    expect(await card.getByLabel("Canonical terminal evidence message").textContent()).toBe(
      content,
    );
    const snapshot = await api.getSession(session);
    const reference = snapshot.terminal_selection_attributions![0];
    expect(snapshot.messages[reference.message_index].content).toBe(content);
    expect(reference.attribution.admission_id).toBe(submissions[0].admission_id);
    await page.reload();
    await expect(card).toHaveCount(1);
    await card.getByText("Source and capture details", { exact: true }).click();
    await expect(card).toContainText(shell.terminal_id);
    await card.getByText("Source and capture details", { exact: true }).click();
    await card
      .getByRole("heading", { name: "Terminal selection", exact: true })
      .scrollIntoViewIfNeeded();
    await card.screenshot({
      path: testInfo.outputPath(`selection-attachment-${mobile ? "mobile" : "desktop"}.png`),
    });
    expect(harness.provider.requests).toHaveLength(1);
    expect(await api.listInbox(session)).toHaveLength(1);
    if (mobile)
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    if (!mobile) {
      const fork = await api.forkSession(session, reference.message_index + 1);
      await page.goto(`${harness.baseUrl}/#/session/${fork.session_id}`);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("Original source from another chat");
      await card.getByText("Source and capture details", { exact: true }).click();
      await expect(card).toContainText(session);
      // Pasted canonical evidence remains ordinary input, even byte identical.
      harness.provider.enqueue(
        "copied-evidence",
        { afterStep: "selected-send", token: evidence },
        { kind: "text", text: "copied literal observed", stream: true },
      );
      await api.submitRun(fork.session_id, content);
      await harness.provider.waitForRequestCount(2);
      await expect
        .poll(async () => (await api.getSession(fork.session_id)).active_run == null)
        .toBe(true);
      await page.reload();
      await expect(card).toHaveCount(1);
      const forkSnapshot = await api.getSession(fork.session_id);
      expect(forkSnapshot.terminal_selection_attributions).toHaveLength(1);
      expect(forkSnapshot.terminal_selection_attributions![0].attribution.source_session_id).toBe(
        session,
      );
      expect((await api.listUserTerminals(fork.session_id)).terminals).toHaveLength(0);
      // Exercise real bounded pages rather than synthetic cache fixtures.
      for (let index = 0; index < 13; index += 1) {
        const prompt = `attachment paging ${index}`;
        harness.provider.enqueue(
          `paging-${index}`,
          { token: prompt },
          { kind: "text", text: `paging answer ${index}`, stream: true },
        );
        await api.submitRun(fork.session_id, prompt);
        await expect
          .poll(async () => (await api.getSession(fork.session_id)).active_run == null)
          .toBe(true);
      }
      await page.reload();
      await expect(page.getByRole("button", { name: "Load older", exact: true })).toBeVisible();
      await expect(card).toHaveCount(0);
      // Exercise the observed cancellation recovery on every runner. This
      // cancels a read, never an admission or model operation.
      let olderReads = 0;
      await page.route("**/messages?before=*", async (route) => {
        olderReads += 1;
        if (olderReads === 1) await route.abort("aborted");
        else await route.continue();
      });
      const older = await loadOlderAfterRefresh(page);
      expect(olderReads).toBeGreaterThanOrEqual(2);
      expect(older.terminal_selection_attributions).toHaveLength(1);
      expect(older.terminal_selection_attributions![0].attribution.source_session_id).toBe(session);
      await expect(card).toHaveCount(1);
      harness.provider.enqueue(
        "tail-refresh",
        { token: "attachment focused refresh" },
        { kind: "text", text: "focused refresh answer", stream: true },
      );
      await api.submitRun(fork.session_id, "attachment focused refresh");
      await expect(page.getByText("focused refresh answer", { exact: true })).toBeVisible();
      await expect(card).toHaveCount(1);
      expect((await api.getSession(fork.session_id)).terminal_selection_attributions).toHaveLength(
        1,
      );
    }
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
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await page.keyboard.type(`printf '${octal(evidence + "\n")}'`);
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
  const shell = (await api.listUserTerminals(session)).terminals[0];
  let dialog = await reviewTerminalEvidence(page, pane, evidence);
  await expect(dialog.getByRole("radio", { name: /Send as a new turn/ })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: /Queue after/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Queue selection", exact: true }).click();
  await expect(dialog).toContainText("Selection admission accepted.");
  await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
  const pending = page.getByLabel("Pending messages");
  await expect(
    pending.getByRole("region", { name: "Terminal selection", exact: true }),
  ).toHaveCount(1);
  await expect(pending.getByLabel("Attached terminal output")).toHaveText(evidence);
  expect((await api.listInbox(session))[0].terminal_selection?.text).toBe(evidence);
  dialog = await reviewTerminalEvidence(page, pane, evidence);
  await dialog.getByRole("radio", { name: /Steer the displayed active run/ }).check();
  await dialog.getByRole("button", { name: "Steer selected run", exact: true }).click();
  await expect(dialog).toContainText("Selection admission accepted.");
  const inbox = await api.listInbox(session);
  expect(inbox).toHaveLength(2);
  expect(inbox[0].delivery).toBe("queue");
  expect(inbox[1].delivery).toBe("steer");
  expect(inbox[1].target_run_id).toBe(active.run_id);
  expect(harness.provider.requests).toHaveLength(1);
  await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
  await expect(
    pending.getByRole("region", { name: "Terminal selection", exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await expect(
    pending.getByRole("region", { name: "Terminal selection", exact: true }),
  ).toHaveCount(2);
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
  await page.goto(`${harness.baseUrl}/#/session/${session}`);
  await expect(page.getByLabel("Pending messages")).toHaveCount(0);
  const cards = page.getByRole("region", { name: "Terminal selection", exact: true });
  await expect(cards).toHaveCount(2);
  await api.terminateTerminal(session, shell.terminal_id);
  harness.provider.assertConsumed();
});

test("queued attachment waits for an exact human command outcome and follows its canonical card once", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await pane.getByRole("button", { name: /^New shell$/i }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
  await page.keyboard.type(`printf '${octal(evidence + "\n")}'`);
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
  const shell = (await api.listUserTerminals(session)).terminals[0];
  const command = await api.submitShellCommand(session, {
    request_id: "selection-command",
    command: `python3 -c "from pathlib import Path; import time; Path('selection-command-started').write_text('ready')\nwhile not Path('selection-command-release').exists(): time.sleep(0.01)\nprint('COMMAND_DONE')"`,
  });
  await expect
    .poll(async () =>
      fs
        .readFile(path.join(harness.runRoot, "workspace/selection-command-started"), "utf8")
        .catch(() => ""),
    )
    .toBe("ready");
  const dialog = await reviewTerminalEvidence(page, pane, evidence);
  await expect(dialog.getByRole("radio", { name: /Send as a new turn/ })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Queue after/ }).check();
  harness.provider.enqueue(
    "after-command",
    { token: evidence },
    { kind: "text", text: "queued command selection observed", stream: true },
  );
  await dialog.getByRole("button", { name: "Queue selection", exact: true }).click();
  await expect(dialog).toContainText("Selection admission accepted.");
  await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
  await expect(
    page.getByLabel("Pending messages").getByRole("region", { name: "Terminal selection" }),
  ).toHaveCount(1);
  expect(harness.provider.requests).toHaveLength(0);
  await fs.writeFile(path.join(harness.runRoot, "workspace/selection-command-release"), "release");
  await expect(page.getByText("queued command selection observed", { exact: true })).toBeVisible();
  const snapshot = await api.getSession(session);
  const commandIndex = snapshot.shell_commands!.find(
    (item) => item.operation_id === command.operation_id,
  )!.transcript_index!;
  expect(snapshot.terminal_selection_attributions![0].message_index).toBeGreaterThan(commandIndex);
  await expect(page.getByRole("article", { name: "User command" })).toContainText("COMMAND_DONE");
  await expect(page.getByRole("region", { name: "Terminal selection", exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByLabel("Pending messages")).toHaveCount(0);
  expect(harness.provider.requests).toHaveLength(1);
  expect((await api.listInbox(session))[0].status).toBe("delivered");
  await api.terminateTerminal(session, shell.terminal_id);
  harness.provider.assertConsumed();
});
