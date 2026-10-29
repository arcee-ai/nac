import { createProject, createSession, expect, test } from "./harness";
import { startHostedFixture } from "./hosted-fixture";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local two-instance caller");
test.use({ orchestration: "0" });

test("embedded dialogs retain local Tab, dismissal, hints and shortcuts across two runtimes", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  const fixture = await startHostedFixture(harness, id, { twoInstances: true });
  try {
    await page.goto(fixture.baseUrl);
    const left = page.getByRole("region", { name: "Left presentation", exact: true });
    const right = page.getByRole("region", { name: "Right presentation", exact: true });
    const views = [left, right];
    const openers = views.map((view) =>
      view.getByRole("button", { name: "Session settings", exact: true }),
    );
    const dialogs = views.map((view) =>
      view.getByRole("dialog", { name: "Session settings", exact: true }),
    );
    for (let index = 0; index < views.length; index += 1) {
      await openers[index].click();
      await expect(dialogs[index]).toBeVisible();
      // A local unsaved draft enables the last footer control without sending a write.
      await dialogs[index]
        .getByRole("textbox", { name: "Session title", exact: true })
        .fill(`${index === 0 ? "Left" : "Right"} unsaved title`);
      await expect(dialogs[index].getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await expect(views[index].locator("[data-nac-content]")).toHaveAttribute("inert", "");
      await expect(views[index].locator("[data-nac-overlays] [role=dialog]")).toHaveCount(1);
    }
    const focusTrace: string[] = [];
    // Revisit the older scope twice: mounting a sibling must not disable its loop.
    for (const index of [0, 1, 0]) {
      const first = dialogs[index].getByRole("button", { name: "Close", exact: true });
      const last = dialogs[index].getByRole("button", { name: "Save", exact: true });
      await last.focus();
      await page.keyboard.press("Tab");
      await expect(first).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(last).toBeFocused();
      focusTrace.push(
        `${index === 0 ? "left" : "right"}: Save -> Tab -> Close -> Shift+Tab -> Save`,
      );
    }
    await page.screenshot({ path: info.outputPath("two-instance-dialogs.png") });

    // The existing model picker is a real nested atom popover, not a test-only overlay.
    const models = dialogs[0].getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first();
    await models.click();
    const search = left.getByPlaceholder("Search models…");
    await expect(search).toBeVisible();
    await search.focus();
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(dialogs[0]).toBeVisible();
    await expect(dialogs[1]).toBeVisible();
    await models.click();
    await expect(search).toBeVisible();
    // A press in the other instance may close the menu but must not dismiss either dialog.
    await dialogs[1].getByText("Session settings", { exact: true }).click();
    await expect(search).toHaveCount(0);
    await expect(dialogs[0]).toBeVisible();
    await expect(dialogs[1]).toBeVisible();

    await dialogs[0].getByRole("textbox", { name: "Session title", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(dialogs[0]).toHaveCount(0);
    await expect(openers[0]).toBeFocused();
    await expect(left.locator("[data-nac-content]")).not.toHaveAttribute("inert", "");
    await expect(dialogs[1]).toBeVisible();
    await expect(right.locator("[data-nac-content]")).toHaveAttribute("inert", "");

    const hide = left.getByRole("button", { name: "Hide sidebar", exact: true });
    await hide.focus();
    await expect(left.getByRole("tooltip")).toBeVisible();
    await expect(hide).toHaveAccessibleDescription(/Hide sidebar/);
    await page.keyboard.press("Escape");
    await expect(left.getByRole("tooltip")).toHaveCount(0);
    await expect(dialogs[1]).toBeVisible();

    // The left runtime has no modal now; the right runtime still does. Its depth
    // must not suppress the focused left view's harmless sidebar shortcut.
    const sidebar = left.locator("[data-sidebar]");
    const rightSidebar = right.locator("[data-sidebar]");
    await expect(sidebar).toHaveCSS("width", "280px");
    await expect(rightSidebar).toHaveCSS("width", "280px");
    const modifier = await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "Meta" : "Control",
    );
    await page.keyboard.press(`${modifier}+h`);
    await expect(sidebar).toHaveCSS("width", "52px");
    await expect(rightSidebar).toHaveCSS("width", "280px");
    await expect(dialogs[1]).toBeVisible();
    await dialogs[1].getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialogs[1]).toHaveCount(0);
    await expect(openers[1]).toBeFocused();
    await expect(right.locator("[data-nac-content]")).not.toHaveAttribute("inert", "");

    const writes = fixture.calls.filter(
      (call) =>
        ["PUT", "PATCH", "DELETE"].includes(call.method) && call.path.startsWith(`/sessions/${id}`),
    );
    expect(writes).toEqual([]);
    await info.attach("two-instance overlay qualification", {
      contentType: "application/json",
      body: JSON.stringify({
        viewport: page.viewportSize(),
        focusTrace,
        proof:
          "Two production NativePresentationRoot runtimes/routers; local first/last Tab, nested model picker Escape/outside press, owned dismissal/focus return, scoped inertness/portals, tooltip accessible description and sidebar shortcut isolation. Unsaved settings cancelled without writes.",
        limitation:
          "Chromium keyboard/AX evidence; no real screen reader, physical touch device or OS IME.",
      }),
    });
  } finally {
    await fixture.stop();
  }
});

test("touch-emulated phone and 200-percent layout equivalent preserve reduced-motion rename and delete", async ({
  harness,
  browser,
  request,
}, info) => {
  test.setTimeout(90_000);
  const project = await createProject(request, harness, { name: "Touch and motion pilot" });
  const id = await createSession(request, harness, "direct", project);
  const title = "Touch motion pilot";
  const seeded = await request.put(`${harness.baseUrl}/sessions/${id}/presentation`, {
    data: { title, pinned: false, expected_version: 0 },
  });
  expect(seeded.ok()).toBe(true);
  const evidence: unknown[] = [];
  for (const scenario of [
    {
      name: "touch-emulated-390",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    {
      name: "200-percent-layout-equivalent-720",
      viewport: { width: 720, height: 450 },
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
    },
  ]) {
    const { name, ...options } = scenario;
    const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      const writes: string[] = [];
      page.on("request", (req) => {
        if (["PUT", "DELETE"].includes(req.method()) && req.url().includes(`/sessions/${id}`))
          writes.push(req.method());
      });
      await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      const environment = await page.evaluate(() => {
        const view = globalThis as unknown as {
          innerWidth: number;
          innerHeight: number;
          devicePixelRatio: number;
          navigator: { maxTouchPoints: number };
          matchMedia: (query: string) => { matches: boolean };
        };
        return {
          width: view.innerWidth,
          height: view.innerHeight,
          scale: view.devicePixelRatio,
          touchPoints: view.navigator.maxTouchPoints,
          coarsePointer: view.matchMedia("(pointer: coarse)").matches,
          reducedMotion: view.matchMedia("(prefers-reduced-motion: reduce)").matches,
        };
      });
      expect(environment.width).toBe(scenario.viewport.width);
      expect(environment.height).toBe(scenario.viewport.height);
      expect(environment.scale).toBe(scenario.deviceScaleFactor);
      expect(environment.reducedMotion).toBe(true);
      if (scenario.hasTouch) {
        expect(environment.touchPoints).toBeGreaterThan(0);
        expect(environment.coarsePointer).toBe(true);
      }
      for (const action of ["Rename", "Delete"]) {
        const opener = page.getByRole("button", { name: `${action} ${title}`, exact: true });
        if (!(await opener.isVisible())) {
          const menu = page.getByRole("button", { name: "Open the menu", exact: true });
          if (scenario.hasTouch) await menu.tap();
          else await menu.click();
        }
        await expect(opener).toBeVisible();
        if (scenario.hasTouch) await opener.tap();
        else {
          await opener.focus();
          await opener.click();
        }
        const dialog = page.getByRole(action === "Rename" ? "dialog" : "alertdialog", {
          name: `${action} session`,
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS("animation-name", "none");
        await expect(dialog).toHaveCSS("transition-property", "none");
        // The Menu remains below this panel. Inspect the top scrim only.
        const scrim = page.locator('[data-slot="dialog-overlay"]').last();
        await expect(scrim).toHaveCSS("transition-property", "none");
        const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
        const confirm = dialog.getByRole("button", {
          name: action === "Rename" ? "Save" : "Delete session",
          exact: true,
        });
        await expect(cancel).toBeInViewport();
        await expect(confirm).toBeInViewport();
        if (action === "Rename")
          await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
            title,
          );
        else await expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
        const capture = info.outputPath(`${name}-${action.toLowerCase()}-reduced-motion.png`);
        await page.screenshot({ path: capture, caret: "hide" });
        await info.attach(`${name} ${action} reduced motion`, {
          path: capture,
          contentType: "image/png",
        });
        if (scenario.hasTouch) await cancel.tap();
        else await cancel.click();
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(page).toHaveURL(`${harness.baseUrl}/#/session/${id}/files`);
      }
      expect(writes).toEqual([]);
      evidence.push({ name, ...environment, writes });
    } finally {
      await context.close();
    }
  }
  await info.attach("touch and reduced-motion qualification", {
    contentType: "application/json",
    body: JSON.stringify({
      evidence,
      notes:
        "Chromium mobile/touch emulation at 390x844 DPR3 and a 720x450 DPR2 layout equivalent of 1440x900 at 200%. Reduced-motion computed panel/scrim styles, real tap cancellation and focus return. This does not establish physical-device, actual browser-zoom, screen-reader or OS IME acceptance.",
    }),
  });
});
