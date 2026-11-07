import fs from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { createProject, createSession, expect, test } from "./harness";
import { startPackedPresentation } from "./packed-presentation-fixture";
import { openNameZoom } from "./session-name-zoom";
import { revealDesktopSidebar } from "./presentation-composed-fixture";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local packed consumer");
test.use({ orchestration: "0", hasTouch: true });

function cacheState(page: Page) {
  return page.evaluate(() => {
    const fixture = globalThis as unknown as {
      __packedQualification: () => Record<
        string,
        {
          id: number;
          closed: boolean;
          queryCount: number;
          fetching: number;
          openStreams: number;
          closedStreams: number;
        }
      >;
    };
    return fixture.__packedQualification();
  });
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => {
    const browser = globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
      requestAnimationFrame: (callback: () => void) => void;
    };
    await browser.document.fonts.ready;
    await new Promise<void>((resolve) =>
      browser.requestAnimationFrame(() => browser.requestAnimationFrame(() => resolve())),
    );
  });
  // Direct viewport capture also preserves the real browser zoom dimensions.
  const cdp = await page.context().newCDPSession(page);
  const file = info.outputPath(`${name}.png`);
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(file, Buffer.from(frame.data, "base64"));
    await info.attach(name, { path: file, contentType: "image/png" });
  } finally {
    await cdp.detach();
  }
}

async function controlGeometry(control: Locator) {
  return control.evaluate((button) => {
    const doc = button.ownerDocument;
    const view = doc.defaultView!;
    const root = button.closest("[data-nac-runtime]")!;
    const card = button.closest('[role="dialog"]')!;
    const box = (element: typeof root) => {
      const r = element.getBoundingClientRect();
      const s = view.getComputedStyle(element);
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
        heightStyle: s.height,
        minHeight: s.minHeight,
        maxHeight: s.maxHeight,
        overflowX: s.overflowX,
        overflowY: s.overflowY,
        contain: s.contain,
        position: s.position,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      };
    };
    const bounds = box(button);
    const rootBounds = box(root);
    const clips = [];
    for (let node = button.parentElement; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (
        /hidden|clip|auto|scroll/.test(style.overflowX + style.overflowY) ||
        style.contain.includes("paint")
      )
        clips.push({ tag: node.tagName, classes: node.className, ...box(node) });
    }
    const hit = doc.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return {
      control: bounds,
      root: rootBounds,
      card: box(card),
      wrapper: box(card.parentElement!),
      footer: box(card.querySelector("footer")!),
      clips,
      centerHit: hit === button || (hit !== null && button.contains(hit)),
      withinRoot:
        bounds.x >= rootBounds.x - 0.5 &&
        bounds.y >= rootBounds.y - 0.5 &&
        bounds.right <= rootBounds.right + 0.5 &&
        bounds.bottom <= rootBounds.bottom + 0.5,
      withinViewport:
        bounds.x >= -0.5 &&
        bounds.y >= -0.5 &&
        bounds.right <= view.innerWidth + 0.5 &&
        bounds.bottom <= view.innerHeight + 0.5,
      viewport: { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio },
      hostScroll: { x: view.scrollX, y: view.scrollY },
    };
  });
}

async function qualifyInstances(page: Page, info: TestInfo, label: string, id: string) {
  const left = page.getByRole("region", { name: "Left presentation", exact: true });
  const right = page.getByRole("region", { name: "Right presentation", exact: true });
  const leftComposer = left.getByRole("combobox", { name: "Message", exact: true });
  const rightComposer = right.getByRole("combobox", { name: "Message", exact: true });
  await expect(leftComposer).toBeVisible();
  await expect(rightComposer).toBeVisible();
  const phone = await page.evaluate(
    () =>
      (globalThis as unknown as { matchMedia: (query: string) => { matches: boolean } }).matchMedia(
        "(max-width: 767.98px)",
      ).matches,
  );
  for (const name of ["Left", "Right"]) {
    await expect.poll(async () => (await cacheState(page))[name].openStreams).toBeGreaterThan(0);
  }
  const initialCaches = await cacheState(page);
  expect(initialCaches.Left.id).not.toBe(initialCaches.Right.id);
  expect(initialCaches.Left.queryCount).toBeGreaterThan(0);
  expect(initialCaches.Right.queryCount).toBeGreaterThan(0);
  await leftComposer.fill("Left draft — keep this text while another runtime is replaced");
  await rightComposer.fill("Right draft — separate binding with the same session ID");
  const host = page.getByRole("textbox", { name: "Host draft", exact: true });
  await host.fill("Host draft remains independent");
  const openers = [left, right].map((view) =>
    view.getByRole("button", { name: "Session settings", exact: true }),
  );
  const dialogs = [left, right].map((view) =>
    view.getByRole("dialog", { name: "Session settings", exact: true }),
  );
  await openers[0].click();
  await expect(dialogs[0]).toBeVisible();
  // ADR0007: phone panels cover the view without background inertness.
  if (phone) await expect(left.locator("[data-nac-content]")).not.toHaveAttribute("inert", "");
  else await expect(left.locator("[data-nac-content]")).toHaveAttribute("inert", "");
  await expect(right.locator("[data-nac-content]")).not.toHaveAttribute("inert", "");
  await expect(page.locator("body > [inert]")).toHaveCount(0);
  await dialogs[0]
    .getByRole("textbox", { name: "Session title", exact: true })
    .fill("Left long unsaved title / preserve the complete error and action context");
  await expect(dialogs[0].getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await openers[1].click();
  await expect(dialogs[1]).toBeVisible();
  await dialogs[1]
    .getByRole("textbox", { name: "Session title", exact: true })
    .fill("Right long unsaved title / preserve the complete error and action context");
  await expect(dialogs[1].getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  if (phone) await expect(right.locator("[data-nac-content]")).not.toHaveAttribute("inert", "");
  else await expect(right.locator("[data-nac-content]")).toHaveAttribute("inert", "");
  const measureControls = async () =>
    Promise.all(
      dialogs.flatMap((dialog, instance) =>
        ["Save", "Cancel", "Close"].map(async (name) => ({
          instance: ["Left", "Right"][instance],
          name,
          ...(await controlGeometry(dialog.getByRole("button", { name, exact: true }))),
        })),
      ),
    );
  // Preserve all controls' pre-oracle geometry, including the outer host scroll.
  const stages = [{ stage: "both-open", controls: await measureControls() }];
  for (const root of [left, right]) {
    await root.scrollIntoViewIfNeeded();
    stages.push({ stage: `host-section-${stages.length}`, controls: await measureControls() });
  }
  await info.attach(`control-geometry-${label}`, {
    contentType: "application/json",
    body: JSON.stringify(stages),
  });
  for (const [index, dialog] of dialogs.entries()) {
    await expect(dialog).toHaveAttribute("data-modal-open", "true");
    await expect(dialog).toHaveCSS("animation-name", "none");
    if (phone) await expect(dialog).toHaveCSS("transition-property", "none");
    await [left, right][index].scrollIntoViewIfNeeded();
    for (const label of ["Save", "Cancel", "Close"]) {
      const control = dialog.getByRole("button", { name: label, exact: true });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const measured = await controlGeometry(control);
      expect(measured.withinRoot).toBe(true);
      expect(measured.withinViewport).toBe(true);
      expect(measured.centerHit).toBe(true);
      if (phone) {
        const box = await control.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
  for (let index = 0; index < dialogs.length; index += 1) {
    const dialog = dialogs[index];
    const last = dialog.getByRole("button", { name: "Save", exact: true });
    const first = dialog.getByRole("button", { name: "Close", exact: true });
    await last.focus();
    await expect(last).toBeFocused();
    await page.keyboard.press("Tab");
    await info.attach(`focus-${label}-${index}`, {
      contentType: "application/json",
      body: JSON.stringify(
        await page.evaluate(() => {
          const browser = globalThis as unknown as {
            document: {
              activeElement: {
                tagName: string;
                textContent: string;
                getAttribute: (name: string) => string | null;
              } | null;
            };
          };
          const active = browser.document.activeElement;
          return {
            tag: active?.tagName,
            text: active?.textContent,
            label: active?.getAttribute("aria-label"),
          };
        }),
      ),
    });
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await expect([left, right][index].locator("[data-nac-overlays] [role=dialog]")).toHaveCount(1);
  }
  // A real nested model picker: composing Escape cannot dismiss it or its parent.
  const model = dialogs[0].getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first();
  await model.click();
  const search = left.getByPlaceholder("Search models…");
  await expect(search).toBeVisible();
  await search.dispatchEvent("keydown", {
    key: "Escape",
    code: "Escape",
    isComposing: true,
    bubbles: true,
  });
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(model).toBeFocused();
  for (const dialog of dialogs) await expect(dialog).toBeVisible();
  await host.click();
  await page.keyboard.press("Escape");
  await expect(dialogs[0]).toBeVisible();
  await expect(dialogs[1]).toBeVisible();
  await expect(host).toBeFocused();
  await capture(page, info, `${label}-packed-two-instance-settings`);

  const title = dialogs[0].getByRole("textbox", { name: "Session title", exact: true });
  await title.focus();
  await title.dispatchEvent("keydown", {
    key: "Escape",
    code: "Escape",
    isComposing: true,
    bubbles: true,
  });
  await expect(dialogs[0]).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogs[0]).toHaveCount(0);
  await expect(openers[0]).toBeFocused();
  await expect(dialogs[1]).toBeVisible();
  await expect(leftComposer).toHaveValue(
    "Left draft — keep this text while another runtime is replaced",
  );

  const failure =
    "Packed fixture could not save this change. The previous value remains available; review the long settings context and retry deliberately.";
  const endpoint = new URL(`/fixture-runtime/sessions/${id}/presentation`, page.url()).href;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts += 1;
    await pending;
    await route.fulfill({ status: 503, json: { error: failure } });
  });
  try {
    const save = dialogs[1].getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect.poll(() => attempts).toBe(1);
    await expect(save).toBeDisabled();
    // Replacing one runtime cannot clear its sibling's pending form or draft.
    // No request reaches the backend: the controlled boundary returns an error.
    await left.getByRole("button", { name: "Replace packed runtime", exact: true }).click();
    await expect(leftComposer).toHaveValue("");
    await expect(dialogs[1]).toBeVisible();
    await expect(
      dialogs[1].getByRole("textbox", { name: "Session title", exact: true }),
    ).toHaveValue("Right long unsaved title / preserve the complete error and action context");
  } finally {
    release();
  }
  // A 503 after a title write has an unknown outcome: the existing setup
  // owner requires review rather than offering an unsafe automatic retry.
  await expect(dialogs[1].getByRole("alert")).toHaveText(
    "The title save outcome is unknown. Refresh and review the saved values before trying again.",
  );
  await expect(dialogs[1].getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(attempts).toBe(1);
  await capture(page, info, `${label}-packed-unknown-save`);
  await dialogs[1].getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rightComposer).toHaveValue(
    "Right draft — separate binding with the same session ID",
  );
  await expect(openers[1]).toBeFocused();
  const menu = right.getByRole("dialog", { name: "Menu", exact: true });
  if (phone) {
    await right.getByRole("button", { name: "Open the menu", exact: true }).tap();
    await expect(menu).toHaveAttribute("data-modal-open", "true");
  }
  if (!phone) await revealDesktopSidebar(right);
  const pin = (phone ? menu : right).getByRole("button", { name: /^Pin / }).first();
  // Compact navigation reveals its row actions on hover or keyboard focus.
  // A clipped sr-only button can satisfy Playwright's visibility geometry.
  if (phone) await pin.tap({ timeout: 5000 });
  else {
    await pin.locator("xpath=ancestor::div[contains(@class, 'group relative')][1]").hover();
    await pin.click({ timeout: 5000 });
  }
  const notifications = right.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications.getByRole("alert")).toContainText(failure);
  await expect(
    left.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert"),
  ).toHaveCount(0);
  await capture(page, info, `${label}-packed-long-error-notification`);
  await notifications.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await expect(notifications.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
  if (phone) {
    await menu.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(menu).toHaveCount(0); // retained 300ms phone exit is part of the contract
  }
  await page.unroute(endpoint);
  await left.getByRole("button", { name: "Close packed runtime", exact: true }).click();
  await expect(left.locator("[data-nac-runtime]")).toHaveCount(0);
  await expect(right.locator("[data-nac-runtime]")).toHaveCount(1);
  await expect.poll(async () => (await cacheState(page)).Left.queryCount).toBe(0);
  const retainedCaches = await cacheState(page);
  expect(retainedCaches.Left.closed).toBe(true);
  expect(retainedCaches.Left.openStreams).toBe(0);
  expect(retainedCaches.Right.openStreams).toBeGreaterThan(0);
  expect(retainedCaches.Right.closed).toBe(false);
  expect(retainedCaches.Right.id).toBe(initialCaches.Right.id);
  expect(retainedCaches.Right.queryCount).toBeGreaterThan(0);
  await expect(host).toHaveValue("Host draft remains independent");
  await expect(page.getByLabel("Product location")).toHaveText("/");
  await expect(page.locator("#sentinel")).toHaveCSS("font-family", "monospace");
  await expect(page.locator("#sentinel")).toHaveCSS("padding", "11px");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(right.locator("[data-nac-runtime]")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body > [inert]")).toHaveCount(0);
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
      matchMedia: (query: string) => { matches: boolean };
      document: { documentElement: { getAttribute: (name: string) => string | null } };
    };
    return {
      width: browser.innerWidth,
      height: browser.innerHeight,
      devicePixelRatio: browser.devicePixelRatio,
      reducedMotion: browser.matchMedia("(prefers-reduced-motion: reduce)").matches,
      hostTheme: browser.document.documentElement.getAttribute("data-theme"),
    };
  });
}

for (const width of [1440, 768, 390]) {
  test(`packed two-instance drafts, local overlays and host controls at ${width}px`, async ({
    harness,
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    const project = await createProject(request, harness);
    const id = await createSession(request, harness, "direct", project);
    const fixture = await startPackedPresentation(harness, id, { twoInstances: true });
    try {
      await page.goto(fixture.baseUrl);
      const environment = await qualifyInstances(page, info, `${width}px`, id);
      expect(
        fixture.calls.filter(
          (call) =>
            ["POST", "PUT", "PATCH", "DELETE"].includes(call.method) &&
            // Existing provider discovery is a read transported by POST.
            !(call.method === "POST" && call.path === "/providers/models"),
        ),
      ).toEqual([]);
      await info.attach("packed qualification receipt", {
        contentType: "application/json",
        body: JSON.stringify({
          integrity: fixture.integrity,
          sha256: fixture.tarballSha256,
          peers: fixture.peerVersions,
          tools: fixture.toolVersions,
          environment,
          calls: fixture.calls,
          limitation:
            "Controlled local proxy/scripted harness, two installed packed roots, reduced motion and light OS preference with supported forced-dark product theme. Synthetic IME key event, not OS input method; no physical touch, real screen reader or signed hosted acceptance.",
        }),
      });
    } finally {
      await fixture.stop();
    }
  });
}

for (const viewportWidth of [1440, 390]) {
  test(`packed two-instance controls at actual 200 percent browser zoom from ${viewportWidth}px`, async ({
    harness,
    request,
  }, info) => {
    test.setTimeout(120_000);
    const project = await createProject(request, harness);
    const id = await createSession(request, harness, "direct", project);
    const fixture = await startPackedPresentation(harness, id, { twoInstances: true });
    try {
      const { context, page, zoom } = await openNameZoom(info, fixture.baseUrl, undefined, {
        width: viewportWidth,
        height: 1000,
      });
      try {
        expect(zoom).toBe(2);
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
        await expect
          .poll(() =>
            page.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth),
          )
          .toBe(viewportWidth / 2);
        await expect
          .poll(() =>
            page.evaluate(
              () => (globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio,
            ),
          )
          .toBe(2);
        const environment = await qualifyInstances(
          page,
          info,
          `actual-zoom200-${viewportWidth}`,
          id,
        );
        expect(environment.width).toBe(viewportWidth / 2);
        expect(environment.devicePixelRatio).toBe(2);
        await info.attach("actual browser zoom receipt", {
          contentType: "application/json",
          body: JSON.stringify({
            zoom,
            viewportWidth,
            environment,
            sha256: fixture.tarballSha256,
            integrity: fixture.integrity,
            limitation:
              "Actual Chromium tabs.setZoom/getZoom; controlled fixture, synthetic IME, no physical-device, real AT or signed-host acceptance.",
          }),
        });
      } finally {
        await context.close();
      }
    } finally {
      await fixture.stop();
    }
  });
}

test("packed presentation CSS is opt-in and leaves the host stylesheet alone", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  const fixture = await startPackedPresentation(harness, id, { stylesheet: false });
  const cssRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(".css")) cssRequests.push(request.url());
  });
  try {
    await page.goto(fixture.baseUrl);
    await expect(page.locator("[data-nac-runtime]")).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeVisible();
    await expect.poll(async () => (await cacheState(page)).Single.openStreams).toBeGreaterThan(0);
    await page.evaluate(async () => {
      const browser = globalThis as unknown as {
        document: { fonts: { ready: Promise<unknown> } };
        requestAnimationFrame: (callback: () => void) => void;
      };
      await browser.document.fonts.ready;
      await new Promise<void>((resolve) =>
        browser.requestAnimationFrame(() => browser.requestAnimationFrame(resolve)),
      );
    });
    expect(cssRequests).toEqual([]);
    await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(0);
    await expect(page.locator("#sentinel")).toHaveCSS("font-family", "monospace");
    await expect(page.locator("body")).toHaveCSS("margin", "17px");
    await info.attach("optional CSS receipt", {
      contentType: "application/json",
      body: JSON.stringify({
        sha256: fixture.tarballSha256,
        integrity: fixture.integrity,
        cssRequests,
        proof:
          "Installed presentation import has no eager stylesheet request. Caller CSS remains caller-owned; visual styling requires the explicit optional stylesheet.",
      }),
    });
  } finally {
    await fixture.stop();
  }
});

test("packed retired responses, timers and shortcuts stay within their binding", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  const fixture = await startPackedPresentation(harness, id, { twoInstances: true });
  const endpoint = new URL(`/fixture-runtime/sessions/${id}/config`, fixture.baseUrl).href;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let oldReads = 0;
  let aborted = false;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(endpoint, async (route) => {
    if (
      route.request().method() !== "GET" ||
      route.request().headers()["x-fixture-binding"] !== "first-Left"
    )
      return route.continue();
    oldReads += 1;
    await held;
    try {
      await route.fulfill({ status: 503, json: { error: "Retired binding read failed" } });
    } catch (error) {
      // Cancellation is also a valid retirement outcome; unrelated route errors are failures.
      if (!/abort|cancel|closed/i.test(route.request().failure()?.errorText ?? "")) throw error;
      aborted = true;
    }
  });
  try {
    await page.goto(fixture.baseUrl);
    const left = page.getByRole("region", { name: "Left presentation", exact: true });
    const right = page.getByRole("region", { name: "Right presentation", exact: true });
    const rightComposer = right.getByRole("combobox", { name: "Message", exact: true });
    await expect(rightComposer).toBeVisible();
    expect(oldReads).toBe(0);
    await left.getByRole("button", { name: "Session settings", exact: true }).click();
    await expect.poll(() => oldReads).toBe(1);
    await rightComposer.fill("Sibling draft survives retirement and timers");
    const initial = await cacheState(page);
    const host = page.getByRole("textbox", { name: "Host draft", exact: true });
    await host.fill("Caller remains independent");
    await right.getByRole("button", { name: "Session settings", exact: true }).click();
    const dialog = right.getByRole("dialog", { name: "Session settings", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Session title" })).toBeVisible();
    await left.getByRole("button", { name: "Replace packed runtime", exact: true }).click();
    const leftComposer = left.getByRole("combobox", { name: "Message", exact: true });
    await expect(leftComposer).toBeVisible();
    release();
    await expect.poll(async () => (await cacheState(page)).Left.openStreams).toBeGreaterThan(0);
    const replacement = await cacheState(page);
    expect(replacement.Left.id).not.toBe(initial.Left.id);
    expect(replacement.Right.id).toBe(initial.Right.id);
    await expect(left.getByRole("alert")).toHaveCount(0);
    await leftComposer.click();
    const modifier = await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/.test(
        (globalThis as unknown as { navigator: { userAgent: string } }).navigator.userAgent,
      )
        ? "Meta"
        : "Control",
    );
    await expect(left.locator("[data-sidebar]")).toHaveCSS("width", "280px");
    await page.keyboard.press(`${modifier}+h`);
    await expect(left.locator("[data-sidebar]")).toHaveCSS("width", "52px");
    await expect(right.locator("[data-sidebar]")).toHaveCSS("width", "280px");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const presentation = new URL(`/fixture-runtime/sessions/${id}/presentation`, fixture.baseUrl)
      .href;
    let writes = 0;
    await page.route(presentation, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      writes += 1;
      await route.fulfill({ status: 503, json: { error: "Local lifetime notification" } });
    });
    const pin = right.getByRole("button", { name: /^Pin / }).first();
    await pin.locator("xpath=ancestor::div[contains(@class, 'group relative')][1]").hover();
    await pin.click();
    const notices = right.getByRole("region", { name: "Notifications", exact: true });
    await expect(notices.getByRole("alert")).toContainText("Local lifetime notification");
    await expect(
      left.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert"),
    ).toHaveCount(0);
    await left.getByRole("button", { name: "Close packed runtime", exact: true }).click();
    // Provider life=3s plus retained150ms exit. Observe real timers, not a fake global clock.
    await expect(notices.getByRole("alert")).toHaveCount(0, { timeout: 6000 });
    expect(writes).toBe(1);
    await expect(rightComposer).toHaveValue("Sibling draft survives retirement and timers");
    await expect(host).toHaveValue("Caller remains independent");
    await right.getByRole("button", { name: "Close packed runtime", exact: true }).click();
    await expect(page.locator("[data-nac-runtime]")).toHaveCount(0);
    await expect
      .poll(async () =>
        Object.values(await cacheState(page)).every(
          (entry) => entry.closed && entry.openStreams === 0 && entry.queryCount === 0,
        ),
      )
      .toBe(true);
    const retired = await page.evaluate(() =>
      (
        globalThis as unknown as {
          __packedRetired: () => { id: number; closed: boolean; openStreams: number }[];
        }
      ).__packedRetired(),
    );
    expect(
      retired.some(
        (entry) => entry.id === initial.Left.id && entry.closed && entry.openStreams === 0,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await info.attach("retired binding receipt", {
      contentType: "application/json",
      body: JSON.stringify({
        sha256: fixture.tarballSha256,
        initial,
        replacement,
        retired,
        oldReads,
        aborted,
        writes,
        limitation:
          "Controlled caller boundary; public runtime close and caller-owned stream observations only.",
      }),
    });
  } finally {
    release();
    await page.unroute(endpoint);
    await fixture.stop();
  }
});
