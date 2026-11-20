import type { Page } from "@playwright/test";

import {
  createSession,
  expect,
  showSidePanel,
  startForegroundChild,
  test,
  waitForRunIdle,
} from "./harness";

/** Counts page requests for browser fullscreen; a full-width drawer must never make one. */
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

test("retains orchestrator Insights selection and drafts through nested Escape in the session panel", async ({
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
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
  const draft = page.getByRole("combobox", { name: "Message", exact: true });
  await draft.fill("E2E orchestrator draft kept");
  await showSidePanel(page);
  const drawer = page.getByRole("complementary", { name: "Insights", exact: true });
  const alpha = drawer.getByRole("button", { name: "alpha-thread, Thread, 1" });
  await alpha.click();
  const overview = drawer
    .getByRole("group", { name: "Thread detail view" })
    .getByRole("button", { name: "Overview" });
  await overview.click();
  const show = drawer.getByRole("group", { name: "Show:" }).locator("button[aria-expanded]");
  await show.click();
  await page.keyboard.press("Escape");
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(overview).toHaveAttribute("aria-pressed", "true");
  const list = drawer.getByRole("button", { name: "Open list", exact: true });
  if (!(await alpha.isVisible()) && (await list.isVisible())) await list.click();
  await expect(alpha).toHaveAttribute("aria-pressed", "true");
  await overview.focus();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(draft).toHaveValue("E2E orchestrator draft kept");
  await expectNoFullscreen(page);
});

// Changing the panel geometry keeps the selected child and both unsent drafts.
for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["tablet", { width: 768, height: 1024 }],
] as const) {
  test(`preserves a selected Subagents preview while reopening its panel on ${name}`, async ({
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
    const delegatedUrl = new RegExp(`/session/${parentId}/delegated$`);
    await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
    const chatDraft = page.getByRole("combobox", { name: "Message", exact: true });
    await chatDraft.fill("E2E chat draft kept under the drawer");

    await showSidePanel(page);
    const docked = page.getByRole("complementary", { name: "Subagents", exact: true });
    const drawer = docked.or(page.getByRole("dialog", { name: "Subagents", exact: true }));
    await expect(drawer).toBeVisible();
    // The newest child opens by default; pick the older one.
    const olderRow = drawer.getByRole("button", { name: "Older child", exact: true });
    const openList = drawer.getByRole("button", { name: "Open list", exact: true });
    if (!(await olderRow.isVisible()) && (await openList.isVisible())) await openList.click();
    await olderRow.click();
    const preview = drawer.getByText("e2e_focus_older_child completed", { exact: true });
    await expect(preview).toBeVisible();
    const childDraft = drawer.getByRole("textbox", { name: "Send a message" });
    await childDraft.fill("E2E child draft kept");

    if (name === "desktop") {
      await expect(docked).toBeVisible();
      const resize = docked.getByRole("separator", { name: "Resize session panel" });
      const width = await resize.getAttribute("aria-valuenow");
      await resize.press("Home");
      await expect(resize).toHaveAttribute("aria-valuenow", "360");
      expect(width).not.toBe("360");
    }
    await expect(preview).toBeVisible();
    await expect(drawer.getByText("e2e_focus_newer_child completed", { exact: true })).toHaveCount(
      0,
    );
    await expect(childDraft).toHaveValue("E2E child draft kept");
    await expect(page).toHaveURL(delegatedUrl);

    await page.getByRole("button", { name: "Session panel", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(chatDraft).toHaveValue("E2E chat draft kept under the drawer");
    await showSidePanel(page);
    if (await olderRow.isVisible()) await olderRow.click();
    await expect(preview).toBeVisible();
    await expect(childDraft).toHaveValue("E2E child draft kept");
    await expect(page).toHaveURL(delegatedUrl);
    await expectNoFullscreen(page);
  });
}
