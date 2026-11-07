import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Response } from "@playwright/test";

import { createDirectSession, expect, showSubagents, startForegroundChild, test } from "./harness";
import {
  captureInspector,
  inspectorZoomBrowser,
  readyInspectorFiles,
  serveInspectorVersion,
} from "./inspector-evidence";

test("inspector phone controls retain 44px hit areas at native scale and actual 200 percent zoom", async ({
  harness,
  context,
  request,
}, info) => {
  test.setTimeout(120_000);
  const parent = await createDirectSession(request, harness);
  await fs.writeFile(
    path.join(harness.runRoot, "workspace", "inspection-notes.txt"),
    "Inspector controls fixture\n",
  );
  const measurements: object[] = [];
  const mutations: string[] = [];
  for (const zoom of [1, 2]) {
    const native =
      zoom === 2
        ? await inspectorZoomBrowser((name) => info.outputPath(name), harness.baseUrl, "after")
        : null;
    const page = native?.page ?? (await context.newPage());
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      // Provider discovery lists models through POST; it is not an inspector mutation.
      const providerListing =
        sent.method() === "POST" &&
        url.origin === new URL(harness.baseUrl).origin &&
        url.pathname === "/providers/models";
      if (sent.method() === "POST" && !providerListing) mutations.push(url.pathname);
    });
    try {
      if (!native) await serveInspectorVersion(page, harness.baseUrl, "after");
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const width = await page.evaluate(
        () => (globalThis as unknown as { innerWidth: number }).innerWidth,
      );
      expect(width).toBe(390 / zoom);
      await page.goto(`${harness.baseUrl}/#/session/${parent}/files`);
      await page.getByRole("button", { name: "Open panel", exact: true }).click();
      await readyInspectorFiles(page, width);
      const files = page.getByRole("dialog", { name: "Files", exact: true });
      const measured: {
        name: string;
        rect: {
          left: number;
          right: number;
          top: number;
          bottom: number;
          width: number;
          height: number;
        };
        hit: boolean;
      }[] = [];
      const measure = async (name: string, control: Locator) => {
        await expect(control).toBeVisible();
        const geometry = await control.evaluate((element) => {
          const view = globalThis as unknown as {
            document: { elementFromPoint: (x: number, y: number) => unknown };
          };
          const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
          const hit = view.document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          return {
            rect: { left, right, top, bottom, width, height },
            hit: hit === element || element.contains(hit),
          };
        });
        measured.push({ name, ...geometry });
      };
      await measure("Branch", files.getByRole("button", { name: "Branch: main", exact: true }));
      await measure("All", files.getByRole("button", { name: "All files", exact: true }));
      await measure(
        "Diff",
        files.getByRole("button", { name: "Diff of changed files", exact: true }),
      );
      await measure("Commit", files.getByRole("button", { name: "Commit", exact: true }));
      await captureInspector(
        page,
        `${process.env.NAC_INSPECTOR_CONTROL_LABEL ?? "after"}-390-zoom${zoom}-files-controls`,
      );
      for (const name of ["Diff of changed files", "All files"]) {
        const listing = files.getByRole("button", { name, exact: true });
        await listing.focus();
        await page.keyboard.press("Enter");
        await expect(listing).toHaveAttribute("aria-pressed", "true");
      }
      const branch = files.getByRole("button", { name: "Branch: main", exact: true });
      await branch.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByPlaceholder("Find or create a branch")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(branch).toBeFocused();
      const commit = files.getByRole("button", { name: "Commit", exact: true });
      await expect(commit).toBeEnabled();
      await commit.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByPlaceholder("Commit message")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(commit).toBeFocused();
      let failing = true;
      let recoveredReads = 0;
      await page.route(`**/sessions/${parent}/children`, async (route) => {
        if (route.request().method() === "GET") {
          if (failing) return route.fulfill({ status: 503, body: "unavailable" });
          recoveredReads += 1;
        }
        return route.fallback();
      });
      const childrenResponse = (response: Response, status: number) => {
        const url = new URL(response.url());
        return (
          url.origin === new URL(harness.baseUrl).origin &&
          url.pathname === `/sessions/${parent}/children` &&
          response.request().method() === "GET" &&
          response.status() === status
        );
      };
      const [unavailable] = await Promise.all([
        page.waitForResponse((response) => childrenResponse(response, 503)),
        page.getByRole("tab", { name: "Subagents", exact: true }).click(),
      ]);
      expect(await unavailable.finished()).toBeNull();
      const alert = page.getByRole("alert").filter({ hasText: "Subagents could not be loaded" });
      await expect(alert).toBeVisible();
      await measure("Retry", alert.getByRole("button", { name: "Try again", exact: true }));
      await captureInspector(
        page,
        `${process.env.NAC_INSPECTOR_CONTROL_LABEL ?? "after"}-390-zoom${zoom}-subagents-error`,
      );
      measurements.push({
        physicalWidth: 390,
        cssWidth: width,
        nativeZoom: zoom,
        controls: measured,
      });
      await fs.writeFile(
        info.outputPath("phone-control-geometry.json"),
        JSON.stringify(measurements, null, 2),
      );
      for (const control of measured) {
        const detail = JSON.stringify({ zoom, width, ...control });
        expect.soft(control.rect.height, detail).toBeGreaterThanOrEqual(44);
        expect.soft(control.rect.width, detail).toBeGreaterThanOrEqual(44);
        expect.soft(control.rect.left, detail).toBeGreaterThanOrEqual(0);
        expect.soft(control.rect.right, detail).toBeLessThanOrEqual(width);
        expect.soft(control.rect.top, detail).toBeGreaterThanOrEqual(0);
        expect.soft(control.rect.bottom, detail).toBeLessThanOrEqual(900 / zoom);
        expect.soft(control.hit, detail).toBe(true);
      }
      const retry = alert.getByRole("button", { name: "Try again", exact: true });
      await retry.focus();
      failing = false;
      const [recovered] = await Promise.all([
        page.waitForResponse((response) => childrenResponse(response, 200)),
        page.keyboard.press("Enter"),
      ]);
      expect(await recovered.finished()).toBeNull();
      await expect(page.getByText("No subagents yet", { exact: true })).toBeVisible();
      expect(recoveredReads).toBe(1);
    } finally {
      if (native) await native.context.close();
      else await page.close();
    }
  }
  expect(harness.provider.requests).toHaveLength(0);
  expect(mutations).toEqual([]);
});

test("older-history retry wraps and retains 44px keyboard recovery at native and actual 200 percent zoom", async ({
  harness,
  context,
  request,
}, info) => {
  test.setTimeout(120_000);
  harness.provider.enqueue(
    "older-history-child",
    { token: "E2E_OLDER_HISTORY_CHILD" },
    { kind: "text", text: "Latest child answer remains" },
  );
  const parent = await createDirectSession(request, harness);
  const started = await startForegroundChild(
    request,
    harness,
    parent,
    "Paged history child",
    "E2E_OLDER_HISTORY_CHILD",
  );
  expect(started.ok()).toBe(true);
  const child = ((await started.json()) as { child_session_id: string }).child_session_id;
  const agentReadsBeforeUI = harness.provider.requests.length;
  const measurements: object[] = [];
  const writes: string[] = [];
  for (const zoom of [1, 2]) {
    const native =
      zoom === 2
        ? await inspectorZoomBrowser((name) => info.outputPath(name), harness.baseUrl, "after")
        : null;
    const page = native?.page ?? (await context.newPage());
    try {
      if (!native) await serveInspectorVersion(page, harness.baseUrl, "after");
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const cssWidth = await page.evaluate(
        () => (globalThis as unknown as { innerWidth: number }).innerWidth,
      );
      expect(cssWidth).toBe(390 / zoom);
      const childSnapshots: Response[] = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          url.origin === new URL(harness.baseUrl).origin &&
          url.pathname === `/sessions/${child}` &&
          response.request().method() === "GET" &&
          response.ok()
        )
          childSnapshots.push(response);
      });
      let historyReads = 0;
      let failing = true;
      await page.route(
        (url) =>
          url.origin === new URL(harness.baseUrl).origin && url.pathname === `/sessions/${child}`,
        async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          // Ask the normal backend for a genuine small window; never fabricate cache/page data.
          const url = new URL(route.request().url());
          url.searchParams.set("message_limit", "1");
          const response = await route.fetch({ url: url.toString() });
          expect(response.ok()).toBe(true);
          expect((await response.json()).message_page).toMatchObject({ has_older: true });
          return route.fulfill({ response });
        },
      );
      await page.route(
        (url) =>
          url.origin === new URL(harness.baseUrl).origin &&
          url.pathname === `/sessions/${child}/messages`,
        async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          historyReads += 1;
          if (failing) return route.fulfill({ status: 503, body: "unavailable" });
          return route.fallback();
        },
      );
      page.on("request", (sent) => {
        const url = new URL(sent.url());
        const providerListing =
          sent.method() === "POST" &&
          url.origin === new URL(harness.baseUrl).origin &&
          url.pathname === "/providers/models";
        if (sent.method() !== "GET" && !providerListing) writes.push(sent.url());
      });
      await page.goto(`${harness.baseUrl}/#/session/${parent}/delegated`);
      await showSubagents(page, true);
      const panel = page.getByRole("dialog", { name: "Subagents", exact: true });
      await panel.getByRole("button", { name: "Paged history child", exact: true }).click();
      const alert = panel.getByRole("alert").filter({ hasText: "Couldn’t load older messages." });
      await expect(alert).toBeVisible();
      await expect(panel.getByText("Latest child answer remains", { exact: true })).toBeVisible();
      // Initial replay schedules a canonical refresh; let its generation fence settle first.
      await expect.poll(() => childSnapshots.length).toBeGreaterThanOrEqual(2);
      expect(await childSnapshots[1].finished()).toBeNull();
      await expect(alert).toBeVisible();
      expect(historyReads).toBe(1);
      const readNotice = () =>
        alert.evaluate((element) => {
          const view = globalThis as unknown as {
            innerHeight: number;
            getComputedStyle: (node: unknown) => { overflowY: string };
            document: { elementFromPoint: (x: number, y: number) => unknown };
          };
          let scroll = element.parentElement;
          while (scroll && !["auto", "scroll"].includes(view.getComputedStyle(scroll).overflowY))
            scroll = scroll.parentElement;
          if (!scroll) throw new Error("No real conversation scroll ancestor");
          const rect = scroll.getBoundingClientRect();
          const notice = element.getBoundingClientRect();
          const top = Math.max(0, rect.top + scroll.clientTop);
          const bottom = Math.min(view.innerHeight, top + scroll.clientHeight);
          const x = (rect.left + rect.right) / 2;
          const y = (top + bottom) / 2;
          const hit = view.document.elementFromPoint(x, y);
          return {
            top,
            bottom,
            noticeTop: notice.top,
            noticeBottom: notice.bottom,
            scrollTop: scroll.scrollTop,
            point: { x, y },
            scrollHit: hit === scroll || scroll.contains(hit),
          };
        });
      const readingBefore = await readNotice();
      let gesture: { isTrusted: boolean; deltaY: number } | null = null;
      if (
        readingBefore.noticeTop < readingBefore.top ||
        readingBefore.noticeBottom > readingBefore.bottom
      ) {
        expect(readingBefore.scrollHit).toBe(true);
        const wheel = alert.evaluate(
          (element) =>
            new Promise<{ isTrusted: boolean; deltaY: number }>((resolve) => {
              element.closest('[role="dialog"]')!.addEventListener(
                "wheel",
                (event: { isTrusted: boolean; deltaY: number }) =>
                  resolve({
                    isTrusted: event.isTrusted,
                    deltaY: event.deltaY,
                  }),
                { once: true, passive: true },
              );
            }),
        );
        await page.mouse.move(readingBefore.point.x, readingBefore.point.y);
        const delta =
          readingBefore.noticeTop < readingBefore.top
            ? readingBefore.noticeTop - readingBefore.top - 8
            : readingBefore.noticeBottom - readingBefore.bottom + 8;
        // Wheel deltas are physical pixels; the measured conversation bounds are CSS pixels.
        await page.mouse.wheel(0, delta * zoom);
        gesture = await wheel;
        expect(gesture.isTrusted).toBe(true);
        await expect
          .poll(async () => (await readNotice()).noticeTop)
          .toBeGreaterThanOrEqual(readingBefore.top);
      }
      const readingAfter = await readNotice();
      expect(readingAfter.noticeBottom).toBeLessThanOrEqual(readingAfter.bottom);
      await fs.writeFile(
        info.outputPath(`older-history-reading-zoom${zoom}.json`),
        JSON.stringify({ readingBefore, gesture, readingAfter }, null, 2),
      );
      const retry = alert.getByRole("button", { name: "Try again", exact: true });
      const geometry = await alert.evaluate((element) => {
        const button = element.querySelector("button")!;
        const label = element.querySelector("span")!;
        const rect = button.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        const view = globalThis as unknown as {
          document: { elementFromPoint: (x: number, y: number) => unknown };
        };
        const hit = view.document.elementFromPoint(
          (rect.left + rect.right) / 2,
          (rect.top + rect.bottom) / 2,
        );
        return {
          button: {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          label: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
          centerHit: hit === button || button.contains(hit),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      });
      measurements.push({
        physicalWidth: 390,
        cssWidth,
        nativeZoom: zoom,
        historyReads,
        ...geometry,
      });
      await fs.writeFile(
        info.outputPath("older-history-retry-geometry.json"),
        JSON.stringify(measurements, null, 2),
      );
      await captureInspector(
        page,
        `${process.env.NAC_INSPECTOR_CONTROL_LABEL ?? "after"}-390-zoom${zoom}-older-history-error`,
      );
      const detail = JSON.stringify({ zoom, cssWidth, ...geometry });
      expect.soft(geometry.button.height, detail).toBeGreaterThanOrEqual(44);
      expect.soft(geometry.button.width, detail).toBeGreaterThanOrEqual(44);
      expect.soft(geometry.button.left, detail).toBeGreaterThanOrEqual(0);
      expect.soft(geometry.button.right, detail).toBeLessThanOrEqual(cssWidth);
      expect.soft(geometry.button.top, detail).toBeGreaterThanOrEqual(0);
      expect.soft(geometry.button.bottom, detail).toBeLessThanOrEqual(900 / zoom);
      expect.soft(geometry.label.left, detail).toBeGreaterThanOrEqual(0);
      expect.soft(geometry.label.right, detail).toBeLessThanOrEqual(cssWidth);
      expect.soft(geometry.scrollWidth, detail).toBeLessThanOrEqual(geometry.clientWidth);
      expect.soft(geometry.centerHit, detail).toBe(true);
      if (cssWidth === 195)
        expect.soft(geometry.button.top, detail).toBeGreaterThanOrEqual(geometry.label.bottom);
      const focusSequence = [];
      for (let tab = 0; tab < 20; tab += 1) {
        const focus = await page.evaluate(() => {
          const view = globalThis as unknown as {
            document: { activeElement: { tagName: string; textContent: string | null } | null };
          };
          return {
            tag: view.document.activeElement?.tagName,
            text: view.document.activeElement?.textContent,
          };
        });
        focusSequence.push(focus);
        if (await retry.evaluate((element) => element.matches(":focus"))) break;
        await page.keyboard.press("Tab");
      }
      await fs.writeFile(
        info.outputPath(`older-history-focus-zoom${zoom}.json`),
        JSON.stringify(focusSequence, null, 2),
      );
      await expect(retry).toBeFocused();
      failing = false;
      const [recovered] = await Promise.all([
        page.waitForResponse(
          (response) => {
            const url = new URL(response.url());
            return (
              url.origin === new URL(harness.baseUrl).origin &&
              url.pathname === `/sessions/${child}/messages` &&
              response.request().method() === "GET" &&
              response.status() === 200
            );
          },
          { timeout: 10_000 },
        ),
        page.keyboard.press("Enter"),
      ]);
      expect(await recovered.finished()).toBeNull();
      const prefix = await recovered.json();
      expect(prefix.page).toEqual({ start: 0, end: 2, total: 3, has_older: false });
      expect(prefix.messages).toContainEqual({ role: "user", content: "E2E_OLDER_HISTORY_CHILD" });
      await expect(alert).toHaveCount(0);
      await expect(panel.getByText("Latest child answer remains", { exact: true })).toBeVisible();
      await expect(panel.getByText("E2E_OLDER_HISTORY_CHILD", { exact: true })).toBeVisible();
      expect(historyReads).toBe(2);
      await expect(page).toHaveURL(new RegExp(`/session/${parent}/delegated$`));
    } finally {
      if (native) await native.context.close();
      else await page.close();
    }
  }
  expect(writes).toEqual([]);
  expect(harness.provider.requests).toHaveLength(agentReadsBeforeUI);
  harness.provider.assertConsumed();
});
