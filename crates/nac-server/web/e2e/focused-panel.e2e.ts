import type { Page } from "@playwright/test";

import { createSession, expect, showSidePanel, startForegroundChild, test } from "./harness";

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
    const chatDraft = page.getByRole("combobox", {
      name: "Message",
      exact: true,
    });
    await chatDraft.fill("E2E chat draft kept under the drawer");

    await showSidePanel(page);
    const docked = page.getByRole("complementary", {
      name: "Subagents",
      exact: true,
    });
    const drawer = docked.or(page.getByRole("dialog", { name: "Subagents", exact: true }));
    await expect(drawer).toBeVisible();
    // The newest child opens by default; pick the older one.
    const olderRow = drawer.getByRole("button", {
      name: "Older child",
      exact: true,
    });
    const openList = drawer.getByRole("button", {
      name: "Open list",
      exact: true,
    });
    if (!(await olderRow.isVisible()) && (await openList.isVisible())) await openList.click();
    await olderRow.click();
    const preview = drawer.getByText("e2e_focus_older_child completed", {
      exact: true,
    });
    await expect(preview).toBeVisible();
    const childDraft = drawer.getByRole("textbox", { name: "Send a message" });
    await childDraft.fill("E2E child draft kept");

    if (name === "desktop") {
      await expect(docked).toBeVisible();
      const resize = docked.getByRole("separator", {
        name: "Resize session panel",
      });
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
