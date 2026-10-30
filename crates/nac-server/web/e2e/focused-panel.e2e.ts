import type { Page } from "@playwright/test";

import {
  createSession,
  expect,
  showSidePanel,
  showSubagents,
  startForegroundChild,
  test,
  waitForRunIdle,
} from "./harness";

/** Counts page requests for browser fullscreen; focusing a panel must never make one. */
async function countFullscreenRequests(page: Page) {
  await page.addInitScript({
    content: `
      window.__fullscreenRequests = 0;
      Element.prototype.requestFullscreen = function () {
        window.__fullscreenRequests += 1;
        return Promise.resolve();
      };
    `,
  });
}

async function expectNoFullscreen(page: Page) {
  expect(await page.evaluate("window.__fullscreenRequests")).toBe(0);
  expect(await page.evaluate("document.fullscreenElement === null")).toBe(true);
}

test("focuses Insights in place and goes back to the same split and selection", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "focus-alpha-dispatch",
    { token: "E2E_FOCUS_THREADS_TOKEN", requiredTools: ["thread"] },
    {
      kind: "function_call",
      name: "thread",
      callId: "focus-alpha",
      arguments: { name: "alpha-thread", action: "E2E_FOCUS_ALPHA_TOKEN inspect the alpha files" },
    },
  );
  harness.provider.enqueue(
    "focus-alpha-worker",
    { token: "E2E_FOCUS_ALPHA_TOKEN", requiredTools: ["read"] },
    { kind: "text", text: "alpha worker completed" },
  );
  harness.provider.enqueue(
    "focus-beta-dispatch",
    { functionOutputCallId: "focus-alpha" },
    {
      kind: "function_call",
      name: "thread",
      callId: "focus-beta",
      arguments: { name: "beta-thread", action: "E2E_FOCUS_BETA_TOKEN inspect the beta files" },
    },
  );
  harness.provider.enqueue(
    "focus-beta-worker",
    { token: "E2E_FOCUS_BETA_TOKEN", requiredTools: ["read"] },
    { kind: "text", text: "beta worker completed" },
  );
  harness.provider.enqueue(
    "focus-orchestrator-completion",
    { functionOutputCallId: "focus-beta" },
    { kind: "text", text: "both threads reported" },
  );
  const sessionId = await createSession(request, harness, "orchestrator");
  const run = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "E2E_FOCUS_THREADS_TOKEN" },
  });
  expect(run.status()).toBe(202);
  await waitForRunIdle(request, harness, sessionId);
  harness.provider.assertConsumed();

  await countFullscreenRequests(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const insightsUrl = new RegExp(`/session/${sessionId}/insights$`);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
  await showSidePanel(page);

  const alphaRow = page.getByRole("button", { name: "alpha-thread, Thread, 1" });
  const betaRow = page.getByRole("button", { name: "beta-thread, Thread, 1" });
  const threadView = page.getByRole("group", { name: "Thread detail view" });
  const overview = threadView.getByRole("button", { name: "Overview" });
  const draft = page.getByRole("combobox", { name: "Message", exact: true });
  const focusPanel = page.getByRole("button", { name: "Focus panel", exact: true });
  const backToChat = page.getByRole("button", { name: "Back to chat", exact: true });
  const focusedHeading = page.getByRole("heading", { name: "Insights — focused" });

  // The split's own context: a picked row, the detail's view, a chat draft.
  await alphaRow.click();
  await overview.click();
  await draft.fill("E2E draft kept beside the panel");
  const splitState = async () => {
    await expect(page).toHaveURL(insightsUrl);
    await expect(focusedHeading).toHaveCount(0);
    await expect(focusPanel).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide panel", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Insights" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(alphaRow).toHaveAttribute("aria-pressed", "true");
    await expect(betaRow).toHaveAttribute("aria-pressed", "false");
    await expect(overview).toHaveAttribute("aria-pressed", "true");
    await expect(draft).toBeVisible();
    await expect(draft).toHaveValue("E2E draft kept beside the panel");
  };
  await splitState();

  // Focused: the same panel names itself and leads back; the chat is covered, not a dialog.
  await focusPanel.click();
  await expect(focusedHeading).toBeVisible();
  await expect(backToChat).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(draft).toBeHidden();
  await expect(alphaRow).toHaveAttribute("aria-pressed", "true");
  await expect(overview).toHaveAttribute("aria-pressed", "true");
  // The project and session navigation stays usable beside it.
  await expect(page.getByRole("button", { name: "New Session" })).toBeEnabled();
  await expect(page).toHaveURL(insightsUrl);

  await page.keyboard.press("Escape");
  await splitState();
  await expect(focusPanel).toBeFocused();

  await focusPanel.click();
  await expect(focusedHeading).toBeVisible();
  await backToChat.click();
  await splitState();
  await expectNoFullscreen(page);

  // Focus is a view of this page, not a location: a reload lands on the split.
  await focusPanel.click();
  await expect(focusedHeading).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(insightsUrl);
  await expect(focusPanel).toBeVisible();
  await expect(focusedHeading).toHaveCount(0);
  await expectNoFullscreen(page);
});

for (const [name, viewport, tablet] of [
  ["desktop", { width: 1440, height: 900 }, false],
  ["tablet", { width: 768, height: 1024 }, true],
] as const) {
  test(`focuses a selected Subagents preview and goes back to it on ${name}`, async ({
    harness,
    page,
    request,
  }) => {
    for (const token of ["E2E_FOCUS_OLDER_CHILD", "E2E_FOCUS_NEWER_CHILD"]) {
      harness.provider.enqueue(
        token,
        { token },
        { kind: "text", text: `${token.toLowerCase()} completed` },
      );
    }
    const parentId = await createSession(request, harness, "direct");
    for (const [title, token] of [
      ["Older child", "E2E_FOCUS_OLDER_CHILD"],
      ["Newer child", "E2E_FOCUS_NEWER_CHILD"],
    ]) {
      const started = await startForegroundChild(request, harness, parentId, title, token);
      expect(started.ok()).toBe(true);
    }
    harness.provider.assertConsumed();

    await countFullscreenRequests(page);
    await page.setViewportSize(viewport);
    await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
    await showSubagents(page, false);
    // The newest child opens by default; pick the older one. A tablet lists them on request.
    if (tablet) await page.getByRole("button", { name: "Open list", exact: true }).click();
    await page.getByRole("button", { name: "Older child", exact: true }).click();
    const preview = page.getByText("e2e_focus_older_child completed");
    await expect(preview).toBeVisible();
    const composer = page.locator("form").filter({
      has: page.getByRole("switch", { name: "Run in the background" }),
    });
    const childDraft = composer.getByRole("textbox", { name: "Send a message" });
    await childDraft.fill("E2E child draft kept");

    const focusedHeading = page.getByRole("heading", { name: "Subagents — focused" });
    await page.getByRole("button", { name: "Focus panel", exact: true }).click();
    await expect(focusedHeading).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(preview).toBeVisible();
    await expect(page.getByText("e2e_focus_newer_child completed")).toHaveCount(0);
    await expect(childDraft).toHaveValue("E2E child draft kept");

    await page.getByRole("button", { name: "Back to chat", exact: true }).click();
    await expect(focusedHeading).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/session/${parentId}/delegated$`));
    await expect(page.getByRole("button", { name: "Focus panel", exact: true })).toBeVisible();
    await expect(preview).toBeVisible();
    await expect(childDraft).toHaveValue("E2E child draft kept");
    if (tablet) await page.getByRole("button", { name: "Open list", exact: true }).click();
    await expect(page.getByRole("button", { name: "Older child", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoFullscreen(page);
  });
}
