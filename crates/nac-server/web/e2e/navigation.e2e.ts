import fs from "node:fs/promises";
import { chromium, type Page, type Locator } from "@playwright/test";
import path from "node:path";
import {
  createProject,
  createSession,
  expect,
  test,
  waitForRunIdle,
  startForegroundChild,
} from "./harness";
import {
  openPhoneMenu,
  openPhonePanel,
  openSessionRowAction,
  sessionRowMenu,
} from "./nav-focus-helpers";
import { ScriptGate } from "./scripted-provider";

test.use({ orchestration: "0" });

const LONG_TITLE =
  "Investigate the repository cache and preserve the complete deployment history across repeated runs";

async function serveNavigationVersion(page: Page, baseUrl: string, before: () => boolean) {
  const baseline = process.env.NAC_NAVIGATION_BASELINE_DIST;
  if (baseline) {
    await page.route(`${baseUrl}/assets/dist/**`, async (route) => {
      if (!before()) return route.continue();
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
      (url) => url.origin === new URL(baseUrl).origin && url.pathname === "/",
      async (route) => {
        if (!before()) return route.continue();
        return route.fulfill({
          body: await fs.readFile(path.join(baseline, "index.html")),
          contentType: "text/html",
        });
      },
    );
  }
}

async function captureFrame(page: Page, file: string) {
  // Capture the browser viewport directly: element screenshot clipping assumes
  // the configured viewport scale and can crop a real browser-zoomed tab.
  const cdp = await page.context().newCDPSession(page);
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(file, Buffer.from(frame.data, "base64"));
  } finally {
    await cdp.detach();
  }
}

async function settleCapture(page: Page, target?: Locator) {
  if (target) {
    await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(target).toBeInViewport();
  }
  await page.evaluate(async () => {
    const { document, requestAnimationFrame } = globalThis as unknown as {
      document: {
        fonts: { ready: Promise<unknown> };
        getAnimations: () => {
          effect: { getTiming: () => { iterations: number } } | null;
          finished: Promise<unknown>;
        }[];
      };
      requestAnimationFrame: (callback: () => void) => void;
    };
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

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
  await serveNavigationVersion(page, harness.baseUrl, () => before);
  const capture = async (name: string) => {
    await page.evaluate(() =>
      (
        globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
      ).document.fonts.ready.then(() => undefined),
    );
    await settleCapture(page);
    const file = info.outputPath(`${name}.png`);
    await captureFrame(page, file);
    await info.attach(name, { path: file, contentType: "image/png" });
    if (process.env.NAC_NAVIGATION_CAPTURE_DIR) {
      await fs.mkdir(process.env.NAC_NAVIGATION_CAPTURE_DIR, { recursive: true });
      await fs.copyFile(file, path.join(process.env.NAC_NAVIGATION_CAPTURE_DIR, `${name}.png`));
    }
  };
  const notify = async () => {
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    // Row actions live in the row's "⋯" menu (a bottom sheet on phones).
    await (
      await openSessionRowAction(menu, page, LONG_TITLE, `Rename ${LONG_TITLE}`)
    ).action.click();
    const dialog = page.getByRole("dialog", { name: "Rename session", exact: true });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Session presentation saved", { exact: true })).toBeVisible();
    const endpoint = `${harness.baseUrl}/sessions/${ids[0]}/presentation`;
    await page.route(endpoint, async (route) =>
      route.fulfill({ status: 503, json: { error: "Navigation fixture could not update pin" } }),
    );
    await (
      await openSessionRowAction(menu, page, LONG_TITLE, `Unpin ${LONG_TITLE}`)
    ).action.click();
    await expect(page.getByText(/Failed to update pin: Navigation fixture/)).toBeVisible();
    await page.unroute(endpoint);
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
        await expect(page.getByText("Get started", { exact: true })).toBeVisible();
        const phone = width < 768;
        // Phones have no sidebar: the session header goes back Home, whose
        // header opens the navigation sheet. Wider screens reveal the sidebar.
        if (phone) {
          await page.getByRole("button", { name: "Home", exact: true }).click();
          await page.getByRole("button", { name: "Open the menu", exact: true }).click();
        } else {
          const expand = page.getByRole("button", { name: "Show sidebar", exact: true });
          if (await expand.isVisible()) await expand.click();
        }
        const nav = phone
          ? page.getByRole("dialog", { name: "Menu", exact: true })
          : page.locator('[data-sidebar="true"]');
        const selected = nav.getByRole("button", { name: LONG_TITLE, exact: true }).first();
        await expect(selected).toBeVisible();
        // Only a sidebar shown beside the session marks it as the current page.
        if (!phone) await expect(selected).toHaveAttribute("aria-current", "page");
        const reveal = nav.getByRole("button", { name: /^See \d+ more$/ });
        if (await reveal.isVisible()) await reveal.click();
        await expect(
          nav.getByRole("button", { name: "Review cache inputs 1", exact: true }),
        ).toBeVisible();
        await selected.focus();
        await settleCapture(page, selected);
        await page.mouse.move(0, 0);
        await capture(`${version}-${width}-navigation-dark`);
        // Keyboard: the row's "⋯" trigger opens its menu on the first item (Rename).
        const { trigger: options, menu: rowMenu } = sessionRowMenu(nav, page, LONG_TITLE);
        const rename = rowMenu.getByRole("menuitem", { name: `Rename ${LONG_TITLE}`, exact: true });
        await options.focus();
        if (!before && width === 390) {
          const box = await options.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Enter");
        await expect(rename).toBeFocused();
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
        await expect(options).toBeFocused();
        await settleCapture(page, options);
        await capture(`${version}-${width}-keyboard-focus`);
        const runningRow = nav.getByRole("button", { name: "Review cache inputs 1", exact: true });
        await runningRow.focus();
        await settleCapture(page, runningRow);
        await capture(`${version}-${width}-running-navigation`);
        if (phone) {
          await notify();
          await settleCapture(page, options);
          await capture(`${version}-${width}-notification-stack`);
          await nav.getByRole("button", { name: LONG_TITLE, exact: true }).click();
          await expect(nav).toBeHidden();
          await expect(page).toHaveURL(new RegExp(`/session/${ids[0]}`));
        } else {
          // Search is the command palette; its session rows navigate.
          await nav.getByRole("button", { name: "Search", exact: true }).click();
          const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
          await palette
            .getByRole("combobox", { name: "Search commands", exact: true })
            .fill("Review cache inputs 8");
          await palette
            .getByRole("option")
            .filter({ hasText: "Review cache inputs 8" })
            .first()
            .click();
          await expect(palette).toBeHidden();
          await expect(page).toHaveURL(new RegExp(`/session/${ids[8]}`));
          await page.goBack();
          await expect(page).toHaveURL(new RegExp(`/session/${ids[0]}`));
        }
        await page.goto(`${harness.baseUrl}/?navigationCards=${width}-${version}#/`);
        await expect(
          page.getByRole("textbox", { name: "What should we work on?", exact: true }),
        ).toBeVisible();
        if (phone) {
          // A phone has no sidebar, so Home is its session list (under the
          // Inbox · Sessions switch) instead of project tiles; project actions
          // stay on each project's header there.
          const list = page.getByRole("region", { name: "Sessions and Inbox", exact: true });
          await expect(
            list.getByRole("button", {
              name: "Navigation verification — repository maintenance, 9 sessions",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            list.getByRole("button", {
              name: "Navigation verification — repository maintenance options",
              exact: true,
            }),
          ).toBeAttached();
          await expect(list.getByRole("link", { name: "Interval tasks" })).toBeVisible();
        } else {
          const projects = page.getByRole("region", { name: "Projects", exact: true });
          const tile = projects.getByRole("button", {
            name: "Navigation verification — repository maintenance",
            exact: true,
          });
          await expect(tile).toBeVisible();
          await expect(tile).toContainText("9 sessions");
          // Project actions stay reachable from the tile; app-wide configuration
          // moved to Settings, which stays one control away.
          await expect(
            tile.getByRole("button", {
              name: "Navigation verification — repository maintenance options",
              exact: true,
            }),
          ).toBeAttached();
          await expect(projects.getByRole("link", { name: "Interval tasks" })).toBeVisible();
        }
        await capture(`${version}-${width}-projects-dark`);
      }
    }
    before = false;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${harness.baseUrl}/#/session/${ids[0]}/insights`);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Open the menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    await (
      await openSessionRowAction(menu, page, LONG_TITLE, `Rename ${LONG_TITLE}`)
    ).action.click();
    const dialog = page.getByRole("dialog", { name: "Rename session", exact: true });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Session presentation saved" }),
    ).toBeVisible();
    await page.route(`${harness.baseUrl}/sessions/${ids[0]}/presentation`, async (route) =>
      route.fulfill({ status: 503, json: { error: "Navigation fixture could not update pin" } }),
    );
    const pin = (await openSessionRowAction(menu, page, LONG_TITLE, `Unpin ${LONG_TITLE}`)).action;
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

test("phone navigation and project actions remain reachable at real 200 percent browser zoom", async ({
  harness,
  request,
}, info) => {
  test.setTimeout(120_000);
  const project = await createProject(request, harness, { name: "Navigation zoom verification" });
  const id = await createSession(request, harness, "direct", project);
  expect(
    (
      await request.put(`${harness.baseUrl}/sessions/${id}/presentation`, {
        data: { title: LONG_TITLE, pinned: false, expected_version: 0 },
      })
    ).ok(),
  ).toBe(true);
  harness.provider.enqueue(
    "zoom-child",
    { token: "NAVIGATION_ZOOM_CHILD" },
    { kind: "text", text: "Zoom fixture complete." },
  );
  const started = await startForegroundChild(
    request,
    harness,
    id,
    "Review nested cache inputs",
    "NAVIGATION_ZOOM_CHILD",
  );
  expect(started.ok()).toBe(true);
  const extension = info.outputPath("zoom-extension");
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(
    path.join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Disposable NAC navigation zoom",
      version: "1.0",
      permissions: ["tabs"],
      background: { service_worker: "worker.js" },
    }),
  );
  await fs.writeFile(
    path.join(extension, "worker.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  const context = await chromium.launchPersistentContext(info.outputPath("zoom-profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    let before = false;
    await serveNavigationVersion(page, harness.baseUrl, () => before);
    await page.goto(harness.baseUrl);
    const zoom = await worker.evaluate(async (url) => {
      const { chrome } = globalThis as unknown as {
        chrome: {
          tabs: {
            query: (options: object) => Promise<{ id: number; url: string }[]>;
            setZoom: (id: number, value: number) => Promise<void>;
            getZoom: (id: number) => Promise<number>;
          };
        };
      };
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url.startsWith(url));
      if (!tab) throw new Error("NAC tab not found");
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    }, harness.baseUrl);
    expect(zoom).toBe(2);
    await expect
      .poll(() =>
        page.evaluate(
          () => (globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio,
        ),
      )
      .toBe(2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1024 });
      for (const version of process.env.NAC_NAVIGATION_BASELINE_DIST
        ? ["before", "after"]
        : ["after"]) {
        before = version === "before";
        await page.goto(
          `${harness.baseUrl}/?navigationZoom=${width}-${version}#/session/${id}/insights`,
        );
        // 200% zoom makes every width a phone: back Home, then the menu.
        await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
        const menu = await openPhoneMenu(page);
        const row = menu.getByRole("button", { name: LONG_TITLE, exact: true });
        await row.focus();
        // The row's "⋯" trigger (after its subagent pill) opens its menu on Rename.
        const { trigger: options, menu: rowMenu } = sessionRowMenu(menu, page, LONG_TITLE);
        const rename = rowMenu.getByRole("menuitem", { name: `Rename ${LONG_TITLE}`, exact: true });
        await options.focus();
        const trigger = await options.boundingBox();
        if (!before) {
          expect(trigger!.width).toBeGreaterThanOrEqual(44);
          expect(trigger!.height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Enter");
        await expect(rename).toBeFocused();
        await page.evaluate(() =>
          (
            globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
          ).document.fonts.ready.then(() => undefined),
        );
        await settleCapture(page, rename);
        const file = info.outputPath(`${version}-${width}-zoom200-navigation.png`);
        await captureFrame(page, file);
        await info.attach(`${version}-${width}-zoom200`, { path: file, contentType: "image/png" });
        if (process.env.NAC_NAVIGATION_CAPTURE_DIR) {
          await fs.mkdir(process.env.NAC_NAVIGATION_CAPTURE_DIR, { recursive: true });
          await fs.copyFile(
            file,
            path.join(process.env.NAC_NAVIGATION_CAPTURE_DIR, path.basename(file)),
          );
        }
        const box = await rename.boundingBox();
        const innerWidth = await page.evaluate(
          () => (globalThis as unknown as { innerWidth: number }).innerWidth,
        );
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(innerWidth + 1);
        if (!before) {
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Rename session", exact: true });
        await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
          LONG_TITLE,
        );
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(options).toBeFocused();
        // Search is the command palette: its session rows keep a readable title.
        await menu.getByRole("button", { name: "Search", exact: true }).click();
        const search = page.getByRole("dialog", { name: "Command palette", exact: true });
        await search
          .getByRole("combobox", { name: "Search commands", exact: true })
          .fill("Investigate");
        const searchRow = search.getByRole("option").filter({ hasText: LONG_TITLE }).first();
        await expect(searchRow).toBeVisible();
        await settleCapture(page, searchRow);
        if (!before) {
          const title = await searchRow.locator("span.truncate").first().boundingBox();
          expect(title!.width).toBeGreaterThan(40);
          const option = await searchRow.boundingBox();
          expect(option!.height).toBeGreaterThanOrEqual(44);
          expect(option!.x).toBeGreaterThanOrEqual(0);
          expect(option!.x + option!.width).toBeLessThanOrEqual(innerWidth + 1);
        }
        const searchFile = info.outputPath(`${version}-${width}-zoom200-search.png`);
        await captureFrame(page, searchFile);
        if (process.env.NAC_NAVIGATION_CAPTURE_DIR)
          await fs.copyFile(
            searchFile,
            path.join(process.env.NAC_NAVIGATION_CAPTURE_DIR, path.basename(searchFile)),
          );
        await page.goto(
          `${harness.baseUrl}/?navigationSubagents=${width}-${version}#/session/${id}/delegated`,
        );
        const subagents = await openPhonePanel(page, "Subagents");
        const childRow = subagents.getByRole("button", {
          name: "Review nested cache inputs",
          exact: true,
        });
        await childRow.focus();
        await settleCapture(page, childRow);
        if (!before) {
          const title = await childRow.locator("span.truncate").first().boundingBox();
          expect(title!.width).toBeGreaterThan(40);
          const action = await subagents
            .getByRole("button", { name: "Rename Review nested cache inputs", exact: true })
            .boundingBox();
          expect(action!.width).toBeGreaterThanOrEqual(44);
          expect(action!.height).toBeGreaterThanOrEqual(44);
        }
        const childFile = info.outputPath(`${version}-${width}-zoom200-subagents.png`);
        await captureFrame(page, childFile);
        if (process.env.NAC_NAVIGATION_CAPTURE_DIR)
          await fs.copyFile(
            childFile,
            path.join(process.env.NAC_NAVIGATION_CAPTURE_DIR, path.basename(childFile)),
          );
      }
    }
  } finally {
    await context.close();
  }
});
