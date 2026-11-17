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

test("retains orchestrator Insights selection and drafts through full width and nested Escape", async ({
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
  await showSidePanel(page, { dock: false });
  const drawer = page.getByRole("dialog", { name: "Insights", exact: true });
  const alpha = drawer.getByRole("button", { name: "alpha-thread, Thread, 1" });
  await alpha.click();
  const overview = drawer
    .getByRole("group", { name: "Thread detail view" })
    .getByRole("button", { name: "Overview" });
  await overview.click();
  const expand = drawer.getByRole("button", { name: "Full width", exact: true });
  await expand.click();
  const exit = drawer.getByRole("button", { name: "Exit full width", exact: true });
  await expect(exit).toHaveAttribute("aria-pressed", "true");
  const show = drawer.getByRole("group", { name: "Show:" }).locator("button[aria-expanded]");
  await show.click();
  await page.keyboard.press("Escape");
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(exit).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(expand).toBeVisible();
  await expect(overview).toHaveAttribute("aria-pressed", "true");
  const list = drawer.getByRole("button", { name: "Open list", exact: true });
  if (!(await alpha.isVisible()) && (await list.isVisible())) await list.click();
  await expect(alpha).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(draft).toHaveValue("E2E orchestrator draft kept");
  await expectNoFullscreen(page);
});

// Full width widens the one floating drawer over the chat. The drawer and the
// panel inside it stay mounted, so going back finds the same selection and
// drafts, and the chat underneath keeps its own.
for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["tablet", { width: 768, height: 1024 }],
] as const) {
  test(`widens a selected Subagents preview to full width and back on ${name}`, async ({
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

    // Full width belongs to the floating drawer, so this journey never docks.
    await showSidePanel(page, { dock: false });
    const drawer = page.getByRole("dialog", { name: "Subagents", exact: true });
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

    const expand = drawer.getByRole("button", { name: "Full width", exact: true });
    const exit = drawer.getByRole("button", { name: "Exit full width", exact: true });
    await expand.click();
    await expect(exit).toHaveAttribute("aria-pressed", "true");
    // One drawer, widened in place, on the same preview and draft.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(preview).toBeVisible();
    await expect(drawer.getByText("e2e_focus_newer_child completed", { exact: true })).toHaveCount(
      0,
    );
    await expect(childDraft).toHaveValue("E2E child draft kept");
    await expect(page).toHaveURL(delegatedUrl);

    // Move off the expand button so its hover tooltip does not own the first Escape.
    await page.mouse.move(0, 0);
    await childDraft.focus();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // Escape leaves full width in place; it must not unmount the selected preview/draft.
    await page.keyboard.press("Escape");
    await expect(expand).toBeVisible();
    await expect(page).toHaveURL(delegatedUrl);
    await expect(preview).toBeVisible();
    await expect(childDraft).toHaveValue("E2E child draft kept");
    await expectNoFullscreen(page);

    // Full width is a view of this page, not a location: a reload finds the
    // drawer in its column (or closed), never full width.
    await expand.click();
    await expect(exit).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(delegatedUrl);
    await showSidePanel(page, { dock: false });
    await expect(drawer.getByRole("button", { name: "Full width", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Exit full width", exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(chatDraft).toHaveValue("E2E chat draft kept under the drawer");
    await expectNoFullscreen(page);
  });
}
