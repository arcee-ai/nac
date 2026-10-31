import fs from "node:fs/promises";
import path from "node:path";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

test.use({ orchestration: "0" });

const LONG_TITLE =
  "Investigate the repository cache and preserve the complete deployment history across repeated runs";

test("project navigation, overflow, phone actions and notification feedback", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  const project = await createProject(request, harness, {
    name: "Navigation verification — repository maintenance",
  });
  const ids: string[] = [];
  for (let index = 0; index < 9; index++) {
    const id = await createSession(request, harness, "direct", project);
    ids.push(id);
    const updated = await request.put(`${harness.baseUrl}/sessions/${id}/presentation`, {
      data: {
        title: index === 0 ? LONG_TITLE : `Review cache inputs ${index}`,
        pinned: index === 0,
        expected_version: 0,
      },
    });
    expect(updated.ok()).toBe(true);
  }
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "navigation-running",
    { token: "Check navigation activity" },
    { kind: "text", text: "Cache inputs checked." },
    gate,
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${ids[1]}/runs`, {
        data: { prompt: "Check navigation activity" },
      })
    ).status(),
  ).toBe(202);
  await gate.accepted;

  // Optional matched predecessor artifact: same API, IDs, fonts, fixture and browser.
  // No source checkout or running service is shared with another task.
  let before = false;
  const baseline = process.env.NAC_NAVIGATION_BASELINE_DIST;
  if (baseline) {
    await page.route(`${harness.baseUrl}/assets/dist/**`, async (route) => {
      if (!before) return route.continue();
      const relative = new URL(route.request().url()).pathname.slice("/assets/dist/".length);
      const file = path.resolve(baseline, relative);
      if (!file.startsWith(path.resolve(baseline) + path.sep)) return route.abort();
      return route.fulfill({
        body: await fs.readFile(file),
        contentType: file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
      });
    });
    await page.route(
      (url) => url.origin === new URL(harness.baseUrl).origin && url.pathname === "/",
      async (route) => {
        if (!before) return route.continue();
        return route.fulfill({
          body: await fs.readFile(path.join(baseline, "index.html")),
          contentType: "text/html",
        });
      },
    );
  }
  const capture = async (name: string) => {
    await page.evaluate(() =>
      (
        globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
      ).document.fonts.ready.then(() => undefined),
    );
    const file = info.outputPath(`${name}.png`);
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
    await info.attach(name, { path: file, contentType: "image/png" });
    if (process.env.NAC_NAVIGATION_CAPTURE_DIR)
      await fs.copyFile(file, path.join(process.env.NAC_NAVIGATION_CAPTURE_DIR, `${name}.png`));
  };
  try {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      for (const version of baseline ? ["before", "after"] : ["after"]) {
        before = version === "before";
        await page.goto(
          `${harness.baseUrl}/?navigation=${width}-${version}#/session/${ids[0]}/insights`,
        );
        await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
        if (width < 768) {
          await page.getByRole("button", { name: "Open the menu", exact: true }).click();
        } else {
          const expand = page.getByRole("button", { name: "Show sidebar", exact: true });
          if (await expand.isVisible()) await expand.click();
        }
        await expect(page.getByText("Get started", { exact: true })).toBeVisible();
        const selected = page.getByRole("button", { name: LONG_TITLE, exact: true }).first();
        await expect(selected).toHaveAttribute("aria-current", "page");
        const reveal = page.getByRole("button", { name: /^See \d+ more$/ });
        if (await reveal.isVisible()) await reveal.click();
        await expect(
          page.getByRole("button", { name: "Review cache inputs 1", exact: true }),
        ).toBeVisible();
        await selected.focus();
        await capture(`${version}-${width}-navigation-dark`);
        const rename = page.getByRole("button", { name: `Rename ${LONG_TITLE}`, exact: true });
        await rename.focus();
        if (!before && width === 390) {
          const box = await rename.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Rename session", exact: true });
        await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
          LONG_TITLE,
        );
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(rename).toBeFocused();
        await capture(`${version}-${width}-keyboard-focus`);
        if (width < 768) {
          await page
            .getByRole("dialog", { name: "Menu", exact: true })
            .getByRole("button", { name: LONG_TITLE, exact: true })
            .click();
          await expect(page.getByRole("dialog", { name: "Menu", exact: true })).toBeHidden();
        } else {
          await page.getByRole("button", { name: "Search chats", exact: true }).click();
          const searchDialog = page.getByRole("dialog", { name: "Search Chats", exact: true });
          await searchDialog
            .getByRole("button", { name: "Review cache inputs 8", exact: true })
            .click();
          await expect(page).toHaveURL(new RegExp(`/session/${ids[8]}`));
          await page.goBack();
          await expect(page).toHaveURL(new RegExp(`/session/${ids[0]}`));
        }
        await page.goto(`${harness.baseUrl}/?navigationCards=${width}-${version}#/`);
        await expect(
          page.getByText("Navigation verification — repository maintenance", { exact: true }),
        ).toBeVisible();
        await capture(`${version}-${width}-projects-dark`);
      }
    }
    before = false;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${harness.baseUrl}/#/session/${ids[0]}/insights`);
    await page.getByRole("button", { name: "Open the menu", exact: true }).click();
    await page.getByRole("button", { name: `Rename ${LONG_TITLE}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Rename session", exact: true });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Session presentation saved" }),
    ).toBeVisible();
    await page.route(`${harness.baseUrl}/sessions/${ids[0]}/presentation`, async (route) =>
      route.fulfill({ status: 503, json: { error: "Navigation fixture could not update pin" } }),
    );
    const pin = page.getByRole("button", { name: `Unpin ${LONG_TITLE}`, exact: true });
    await pin.click();
    await expect(page.getByRole("alert").filter({ hasText: "Failed to update pin" })).toBeVisible();
    await capture("after-390-notification-stack-reduced-motion");
    const close = page.getByRole("button", { name: "Dismiss notification", exact: true }).last();
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Failed to update pin" })).toHaveCount(
      0,
    );
    const overflow = await page.evaluate(() => {
      const { document } = globalThis as unknown as {
        document: { documentElement: { scrollWidth: number; clientWidth: number } };
      };
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
  } finally {
    gate.release();
    await waitForRunIdle(request, harness, ids[1]);
  }
});
