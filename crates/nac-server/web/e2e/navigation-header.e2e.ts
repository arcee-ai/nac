import fs from "node:fs/promises";
import path from "node:path";
import { createSession, expect, startForegroundChild, test } from "./harness";

test.afterEach(async ({ page }) => {
  // This case owns every route on its page. Drain a late child read before
  // Playwright disposes its response context; handler errors remain failures.
  await page.unrouteAll({ behavior: "wait" });
});

test("delegated phone header retains intrinsic change counts and its parent route", async ({
  harness,
  page,
  request,
}, info) => {
  const parent = await createSession(request, harness, "direct");
  harness.provider.enqueue(
    "header-child",
    { token: "NAVIGATION_HEADER_CHILD" },
    { kind: "text", text: "Header fixture complete." },
  );
  const response = await startForegroundChild(
    request,
    harness,
    parent,
    "Inspect change totals",
    "NAVIGATION_HEADER_CHILD",
  );
  expect(response.ok()).toBe(true);
  const child = (await response.json()).child_session_id as string;
  // Only the read response's counts are controlled. The child relationship,
  // runtime, snapshot loading and navigation use the real isolated server.
  await page.route(
    (url) =>
      url.origin === new URL(harness.baseUrl).origin && url.pathname === `/sessions/${child}`,
    async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      await route.fulfill({
        response,
        json: {
          ...snapshot,
          workspace: { ...snapshot.workspace, total_additions: 1234, total_deletions: 5678 },
        },
      });
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness.baseUrl}/#/session/${child}/insights`);
  const heading = page.locator("header");
  // The phone session header is back (the parent crumb) plus one "Open panel"
  // button. Measure the actual buttons, not any elevated outer wrapper.
  const parentLink = heading.getByRole("button", { name: /, parent chat$/ });
  const openPanel = heading.getByRole("button", { name: "Open panel", exact: true });
  for (const button of [parentLink, openPanel]) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  // A phone has no room for header pills: the intrinsic totals ride on the
  // panel sheet's Files row and must fit there without clipping.
  await openPanel.click();
  const sheet = page.getByRole("dialog", { name: "Session", exact: true });
  const files = sheet.getByRole("button").filter({ hasText: /^Files/ });
  await expect(files).toBeVisible();
  await expect(files.getByText("+1234", { exact: true })).toHaveCount(1);
  await expect(files.getByText("−5678", { exact: true })).toHaveCount(1);
  const badge = files.getByText("+1234", { exact: true }).locator("..");
  await expect.poll(() => badge.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const badgeBox = await badge.boundingBox();
  const rowBox = await files.boundingBox();
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(390);
  await page.evaluate(() =>
    (
      globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
    ).document.fonts.ready.then(() => undefined),
  );
  const file = info.outputPath("after-390-delegated-header-counts.png");
  await page.screenshot({ path: file, caret: "hide" });
  await info.attach("delegated header with controlled large totals", {
    path: file,
    contentType: "image/png",
  });
  if (process.env.NAC_NAVIGATION_CAPTURE_DIR) {
    await fs.mkdir(process.env.NAC_NAVIGATION_CAPTURE_DIR, { recursive: true });
    await fs.copyFile(file, path.join(process.env.NAC_NAVIGATION_CAPTURE_DIR, path.basename(file)));
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await parentLink.click();
  await expect(page).toHaveURL(new RegExp(`/session/${parent}/delegated`));
  harness.provider.assertConsumed();
});
