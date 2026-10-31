import path from "node:path";
import fs from "node:fs/promises";
import { openNameZoom } from "./session-name-zoom";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import { createProject, createSession, expect, test, startForegroundChild } from "./harness";
import { startHostedFixture } from "./hosted-fixture";

const prefix = "Investigate the same long session prefix and preserve all navigation cues — ";
const names = [prefix + "Alpha 雪🙂", prefix + "Beta λ🚀", "unbroken".repeat(15)];
test.use({ hasTouch: true });
const baseline = process.env.NAC_NAME_BASELINE === "1";
test.skip(!!process.env.NAC_E2E_REMOTE, "Uses isolated disposable sessions");

async function serveBaseline(page: Page, baseUrl: string) {
  const directory = process.env.NAC_NAME_BASELINE_DIST;
  if (!baseline || !directory) return;
  await page.route(`${baseUrl}/assets/dist/**`, async (route) => {
    const relative = new URL(route.request().url()).pathname.slice("/assets/dist/".length);
    const file = path.resolve(directory, relative);
    if (!file.startsWith(path.resolve(directory) + path.sep)) return route.abort();
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
    (url) => url.origin === baseUrl && url.pathname === "/",
    async (route) => {
      const live = await (await route.fetch()).text();
      const binding =
        live.match(/<script id="nac-presentation-binding"[\s\S]*?<\/script>/)?.[0] ?? "";
      const html = await fs.readFile(path.join(directory, "index.html"), "utf8");
      return route.fulfill({
        body: html.replace("</head>", binding + "</head>"),
        contentType: "text/html",
      });
    },
  );
}

async function rename(
  request: APIRequestContext,
  baseUrl: string,
  id: string,
  title: string,
  version = 0,
) {
  const response = await request.put(`${baseUrl}/sessions/${id}/presentation`, {
    data: { title, pinned: false, expected_version: version },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function fits(page: Page, overlay: Locator) {
  const rect = await overlay.boundingBox();
  expect(rect).not.toBeNull();
  const viewport = await page.evaluate(() => {
    const browser = globalThis as unknown as { innerWidth: number; innerHeight: number };
    return { width: browser.innerWidth, height: browser.innerHeight };
  });
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await page.locator("html").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
    true,
  );
}
async function viewName(page: Page, trigger: Locator, name: string) {
  if (page.viewportSize()!.width < 768) await trigger.tap();
  else await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Full session name", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  const text = dialog.locator("[data-full-session-name]");
  await expect(text).toHaveText(name);
  expect(
    await text.evaluate(
      (node) => node.ownerDocument.defaultView!.getComputedStyle(node).userSelect,
    ),
  ).toBe("text");
  expect(await text.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await fits(page, dialog);
  await text.dblclick();
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { getSelection(): { toString(): string } | null })
          .getSelection()
          ?.toString().length ?? 0,
    ),
  ).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Copy name", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Name copied");
  expect(
    await page.evaluate(() =>
      (
        globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
      ).navigator.clipboard.readText(),
    ),
  ).toBe(name);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => {
    const { document } = globalThis as unknown as {
      document: {
        fonts: { ready: Promise<unknown> };
        getAnimations(): {
          effect: { getTiming(): { iterations: number } } | null;
          finished: Promise<unknown>;
        }[];
      };
    };
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(
      info.outputPath(`${baseline ? "before" : "after"}-${name}.png`),
      Buffer.from(frame.data, "base64"),
    );
  } finally {
    await cdp.detach();
  }
}
async function tokens(page: Page, theme: string) {
  // Product currently forces dark. Exercise the existing light token boundary
  // without changing that product policy or adding a theme picker.
  await page.locator("html, [data-nac-runtime]").evaluateAll((nodes, value) => {
    for (const node of nodes) {
      node.classList.remove("dark", "light");
      node.classList.add(value);
      node.setAttribute("data-theme", value);
    }
  }, theme);
}

for (const width of [1440, 768, 390])
  for (const theme of ["dark", "light"]) {
    test(`full names on navigation ${width} ${theme}`, async ({
      harness,
      page,
      request,
      context,
    }, info) => {
      test.setTimeout(90_000);
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.setViewportSize({ width, height: 900 });
      await serveBaseline(page, harness.baseUrl);
      const project = await createProject(request, harness, { name: "Session name acceptance" });
      const ids: string[] = [];
      for (const name of names) {
        const id = await createSession(request, harness, "direct", project);
        await rename(request, harness.baseUrl, id, name);
        ids.push(id);
      }
      const fallback = await createSession(request, harness, "direct", project);
      await page.goto(`${harness.baseUrl}/#/session/${ids[0]}/files`);
      await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
      await tokens(page, theme);
      const url = page.url();
      const mutations: string[] = [];
      page.on("request", (req) => {
        if (!["GET", "HEAD"].includes(req.method()) && !req.url().endsWith("/providers/models"))
          mutations.push(req.url());
      });
      if (baseline) {
        if (width >= 768) {
          const show = page.getByRole("button", { name: "Show sidebar", exact: true });
          if (await show.isVisible()) await show.click();
          await page
            .locator("[data-sidebar]")
            .getByRole("button", { name: new RegExp("^Investigate.*Beta") })
            .hover();
        }
        await capture(page, info, `${width}-${theme}`);
        return;
      }
      const heading = page.getByRole("button", {
        name: `View full name: ${names[0]}`,
        exact: true,
      });
      await viewName(page, heading, names[0]);
      if (width < 768) {
        await capture(page, info, `${width}-${theme}`);
        await heading.tap();
        await capture(page, info, `full-name-${width}-${theme}`);
        await page.keyboard.press("Escape");
      }
      if (width >= 768) {
        const show = page.getByRole("button", { name: "Show sidebar", exact: true });
        if (await show.isVisible()) await show.click();
        const sidebar = page.locator("[data-sidebar]");
        for (const name of names.slice(0, 2)) {
          const row = sidebar.getByRole("button", {
            name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`),
          });
          await row.hover();
          await expect(page.getByRole("tooltip")).toContainText(name);
          await fits(page, page.locator('[data-slot="tooltip-content"]').last());
          await capture(page, info, `${width}-${theme}`);
          await page.keyboard.press("Escape");
          await expect(page.getByRole("tooltip")).toHaveCount(0);
          await row.focus();
          await page.keyboard.press("Tab");
          await page.keyboard.press("Shift+Tab");
          await expect(page.getByRole("tooltip")).toContainText(name);
          await page.keyboard.press("Escape");
          await viewName(
            page,
            row.locator("..").getByRole("button", { name: "View full name", exact: true }),
            name,
          );
        }
        await page.getByRole("button", { name: "Search chats", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Open the menu", exact: true }).click();
      }
      // Both project history and phone navigation consume the same row atom.
      const visibleRows = page.locator("button[aria-label]").filter({ hasText: names[1] });
      const row = visibleRows.last();
      await expect(row).toBeVisible();
      if (width >= 768) await row.hover();
      const rowAction = row
        .locator("..")
        .getByRole("button", { name: "View full name", exact: true });
      await viewName(page, rowAction, names[1]);
      const unbroken = page.locator("button[aria-label]").filter({ hasText: names[2] }).last();
      if (width >= 768) await unbroken.hover();
      await viewName(
        page,
        unbroken.locator("..").getByRole("button", { name: "View full name", exact: true }),
        names[2],
      );
      const fallbackRow = page.getByRole("button", { name: /^New Session(?:,|$)/ }).last();
      if (width >= 768) await fallbackRow.hover();
      await viewName(
        page,
        fallbackRow.locator("..").getByRole("button", { name: "View full name", exact: true }),
        "New Session",
      );
      await page.keyboard.press("Escape");
      expect(page.url()).toBe(url);
      expect(mutations).toEqual([]);
      // Normal row activation still navigates, including touch-sized navigation.
      if (width < 768) {
        await page.getByRole("button", { name: "Open the menu", exact: true }).click();
        await page
          .getByRole("button", { name: new RegExp(`^${names[2]}`) })
          .last()
          .click();
      } else {
        await page
          .locator("[data-sidebar]")
          .getByRole("button", { name: new RegExp(`^${names[2]}`) })
          .click();
      }
      await expect(page).toHaveURL(new RegExp(`/session/${ids[2]}/`));
      expect(fallback).toBeTruthy();
    });
  }

test("extreme current name, rename, navigation and deletion lifetimes", async ({
  harness,
  page,
  request,
  context,
}, info) => {
  test.skip(baseline);
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await createSession(request, harness, "direct");
  const other = await createSession(request, harness, "direct");
  await rename(request, harness.baseUrl, id, names[0]);
  await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
  const heading = page.getByRole("button", { name: `View full name: ${names[0]}`, exact: true });
  await heading.click();
  await rename(request, harness.baseUrl, id, "Renamed current 雪🙂", 1);
  await expect(page.locator("[data-full-session-name]")).toHaveText("Renamed current 雪🙂");
  await page.evaluate((next) => {
    location.hash = `#/session/${next}/files`;
  }, other);
  await expect(page.getByRole("dialog", { name: "Full session name" })).toHaveCount(0);

  // The API caps newly edited titles at 120 code points; a read-only response
  // fixture exercises oversized legacy/consumer input without changing that contract.
  const extreme = "Extreme 雪🙂 " + "Unbroken".repeat(1800);
  await page.route(
    (url) => url.pathname === "/sessions" || url.pathname === `/sessions/${id}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      if (!response.headers()["content-type"]?.includes("application/json"))
        return route.fulfill({ response });
      const body = await response.json();
      const rewrite = (value: unknown): void => {
        if (value == null || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (record.session_id === id && "title" in record) record.title = extreme;
        for (const child of Object.values(record)) rewrite(child);
      };
      rewrite(body);
      return route.fulfill({ response, json: body });
    },
  );
  await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: `View full name: ${extreme}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Full session name", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator("[data-full-session-name]")).toHaveText(extreme);
    expect(
      await dialog
        .locator("[data-full-session-name]")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await fits(page, dialog);
    await capture(page, info, `extreme-${width}`);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: `View full name: ${extreme}`, exact: true }).click();
  expect((await request.delete(`${harness.baseUrl}/sessions/${id}`)).ok()).toBe(true);
  await expect(page.getByRole("dialog", { name: "Full session name" })).toHaveCount(0);
});

test("embedded consumers keep full-name layers and keyboard ownership isolated", async ({
  harness,
  page,
  request,
}) => {
  test.skip(baseline);
  test.setTimeout(90_000);
  const id = await createSession(request, harness, "direct");
  await rename(request, harness.baseUrl, id, names[0]);
  const fixture = await startHostedFixture(harness, id, { twoInstances: true });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(fixture.baseUrl);
    const left = page.getByRole("region", { name: "Left presentation" });
    const right = page.getByRole("region", { name: "Right presentation" });
    const trigger = left.getByRole("button", { name: `View full name: ${names[0]}`, exact: true });
    await trigger.click();
    const dialog = left.getByRole("dialog", { name: "Full session name" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => !!node.closest("[data-nac-overlays]"))).toBe(true);
    await expect(right.getByRole("dialog")).toHaveCount(0);
    expect(await right.locator("[data-nac-content]").getAttribute("inert")).toBeNull();
    await right.getByRole("button", { name: `View full name: ${names[0]}`, exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally {
    await fixture.stop();
  }
});

for (const width of [1440, 390])
  test(`parent names preserve lineage and navigation ${width}`, async ({
    harness,
    page,
    request,
    context,
  }) => {
    test.skip(baseline);
    test.setTimeout(90_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const parent = await createSession(request, harness, "direct");
    await rename(request, harness.baseUrl, parent, names[0]);
    harness.provider.enqueue(
      "NAME_CHILD",
      { token: "NAME_CHILD" },
      { kind: "text", text: "complete" },
    );
    const response = await startForegroundChild(request, harness, parent, names[1], "NAME_CHILD");
    expect(response.ok()).toBe(true);
    const child = ((await response.json()) as { child_session_id: string }).child_session_id;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${harness.baseUrl}/#/session/${child}/files`);
    const parentLink = page.getByRole("button", { name: `${names[0]}, parent chat`, exact: true });
    await expect(parentLink).toBeVisible();
    if (width >= 768) {
      await parentLink.hover();
      await expect(page.getByRole("tooltip")).toHaveText(names[0]);
      await page.keyboard.press("Escape");
    }
    const action = parentLink
      .locator("..")
      .getByRole("button", { name: "View full name", exact: true });
    const url = page.url();
    await viewName(page, action, names[0]);
    expect(page.url()).toBe(url);
    await parentLink.click();
    await expect(page).toHaveURL(new RegExp(`/session/${parent}/delegated$`));
  });

for (const width of [1440, 768, 390])
  test(`retained tab strip and session collection ${width}`, async ({
    harness,
    page,
    request,
    context,
  }, info) => {
    test.skip(baseline);
    test.setTimeout(90_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = await createProject(request, harness);
    const ids: string[] = [];
    for (const name of names) {
      const id = await createSession(request, harness, "direct", project);
      await rename(request, harness.baseUrl, id, name);
      ids.push(id);
    }
    const fixture = await startHostedFixture(harness, ids[0], { nameSurfaces: true });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(fixture.baseUrl);
      const tabs = page.getByRole("region", { name: "Retained tab strip" });
      const collection = page.getByRole("navigation", { name: "All sessions" });
      for (const theme of ["dark", "light"]) {
        await tokens(page, theme);
        for (const name of names.slice(0, 2)) {
          const tab = tabs.locator(".chat-session-tab").filter({
            has: page.getByRole("button", { name: `${name}, Direct coding agent`, exact: true }),
          });
          const trigger = tab.getByRole("button", {
            name: `${name}, Direct coding agent`,
            exact: true,
          });
          await trigger.scrollIntoViewIfNeeded();
          if (width >= 768) {
            await trigger.hover();
            await expect(page.getByRole("tooltip")).toContainText(name);
            await fits(page, page.locator('[data-slot="tooltip-content"]').last());
            await page.keyboard.press("Escape");
          } else {
            await trigger.focus();
            await page.keyboard.press("Tab");
          }
          await viewName(
            page,
            tab.getByRole("button", { name: "View full name", exact: true }),
            name,
          );
          const row = collection.getByRole("button", {
            name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`),
          });
          if (width >= 768) await row.hover();
          await viewName(
            page,
            row.locator("..").getByRole("button", { name: "View full name", exact: true }),
            name,
          );
        }
        await capture(page, info, `retained-${width}-${theme}`);
      }
      const strip = tabs.locator("[data-session-tab-strip]");
      const widths = await tabs
        .locator(".chat-session-tab")
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
      expect(widths.every((value) => value <= 272)).toBe(true);
      if (width <= 768)
        expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      // Disclosure does not dismiss a tab; the existing close action still does.
      await expect(tabs.locator(".chat-session-tab")).toHaveCount(3);
      await tabs.getByRole("button", { name: `Close ${names[1]}`, exact: true }).click();
      await expect(tabs.locator(".chat-session-tab")).toHaveCount(2);
      await tabs.getByRole("button", { name: "All chats in this project", exact: true }).click();
      const listRow = page
        .getByRole("button", { name: `${names[1]}, Direct coding agent`, exact: true })
        .last();
      if (width >= 768) await listRow.hover();
      await viewName(
        page,
        listRow.locator("..").getByRole("button", { name: "View full name", exact: true }),
        names[1],
      );
    } finally {
      await fixture.stop();
    }
  });

test("full names at real 200 percent browser zoom", async ({ harness, request }, info) => {
  test.skip(baseline);
  test.setTimeout(90_000);
  const id = await createSession(request, harness, "direct");
  await rename(request, harness.baseUrl, id, names[0]);
  const { context, page, zoom } = await openNameZoom(info, harness.baseUrl);
  try {
    expect(zoom).toBe(2);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
      for (const theme of ["dark", "light"]) {
        await tokens(page, theme);
        const heading = page.getByRole("button", {
          name: `View full name: ${names[0]}`,
          exact: true,
        });
        await viewName(page, heading, names[0]);
        await heading.click();
        await capture(page, info, `zoom200-${width}-${theme}`);
        await page.keyboard.press("Escape");
      }
    }
  } finally {
    await context.close();
  }
});
