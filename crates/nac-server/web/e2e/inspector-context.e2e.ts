import fs from "node:fs/promises";
import path from "node:path";
import { type Page, type Locator, type APIRequestContext } from "@playwright/test";

import {
  createDirectSession,
  expect,
  showSidePanel,
  startForegroundChild,
  test,
  waitForRunIdle,
  type EmbeddedHarness,
} from "./harness";
import {
  captureInspector,
  inspectorZoomBrowser,
  readyInspectorChild,
  readyInspectorFiles,
  serveInspectorVersion,
  type InspectorVersion,
} from "./inspector-evidence";

import { ScriptGate } from "./scripted-provider";
import { assertInspectorReadable } from "./inspector-readability";

test.use({ hasTouch: true });

const captureVersions: InspectorVersion[] =
  process.env.NAC_INSPECTOR_BASELINE_ONLY === "1"
    ? ["before"]
    : process.env.NAC_INSPECTOR_BASELINE_DIST
      ? ["before", "after"]
      : ["after"];

const CHILD = "Audit captured changes and preserve the complete verification history";

// Observe only the browser's existing parent SSE connection; never create one.
async function observeParentStream(page: Page, baseUrl: string, parent: string) {
  const cdp = await page.context().newCDPSession(page);
  const active = new Set<string>();
  let reasoning = "";
  cdp.on("Network.responseReceived", (event) => {
    const url = new URL(event.response.url);
    if (
      event.type === "EventSource" &&
      event.response.status === 200 &&
      url.origin === new URL(baseUrl).origin &&
      url.pathname === `/sessions/${parent}/events/stream`
    )
      active.add(event.requestId);
  });
  const remove = (event: { requestId: string }) => active.delete(event.requestId);
  cdp.on("Network.loadingFailed", remove);
  cdp.on("Network.loadingFinished", remove);
  cdp.on("Network.eventSourceMessageReceived", (event) => {
    if (!active.has(event.requestId) || event.eventName !== "assistant_delta") return;
    const delta = JSON.parse(event.data) as {
      thread_name: string | null;
      reasoning?: string;
      reset?: boolean;
    };
    if (delta.thread_name !== null) return;
    if (delta.reset) reasoning = "";
    reasoning += delta.reasoning ?? "";
  });
  await cdp.send("Network.enable");
  return {
    ready: () => expect.poll(() => active.size).toBeGreaterThan(0),
    absent: () => expect.poll(() => active.size).toBe(0),
    sawReasoning: (text: string) => expect.poll(() => reasoning).toContain(text),
    close: () => cdp.detach(),
  };
}

async function fixture(request: APIRequestContext, harness: EmbeddedHarness, longList = false) {
  const parent = await createDirectSession(request, harness);
  harness.provider.enqueue(
    "inspector-child",
    { token: "INSPECTOR_CHILD" },
    {
      kind: "text",
      text: "The child inspected the captured changes. No files were modified.",
    },
  );
  const started = await startForegroundChild(request, harness, parent, CHILD, "INSPECTOR_CHILD");
  expect(started.ok()).toBe(true);
  const child = ((await started.json()) as { child_session_id: string }).child_session_id;
  harness.provider.enqueue(
    "inspector-status",
    { token: "INSPECTOR_PARENT" },
    {
      kind: "function_call",
      name: "subagent_status",
      callId: "inspector-status",
      arguments: { child_session_id: child },
    },
  );
  let previous = "inspector-status";
  for (let index = 0; index < (longList ? 24 : 1); index += 1) {
    const callId = `inspector-files-${index}`;
    harness.provider.enqueue(
      callId,
      { functionOutputCallId: previous },
      {
        kind: "function_call",
        name: "glob",
        callId,
        arguments: { pattern: "*.txt" },
      },
    );
    previous = callId;
  }
  harness.provider.enqueue(
    "inspector-answer",
    { functionOutputCallId: previous },
    {
      kind: "text",
      text: "The parent retained the original inspection context.",
    },
  );
  await fs.writeFile(
    path.join(harness.runRoot, "workspace", "inspection-notes.txt"),
    "Existing checkout notes\n",
  );
  const run = await request.post(`${harness.baseUrl}/sessions/${parent}/runs`, {
    data: { prompt: "INSPECTOR_PARENT" },
  });
  expect(run.status()).toBe(202);
  await waitForRunIdle(request, harness, parent);
  harness.provider.assertConsumed();
  return { parent, child };
}

type PhoneFilterEvidence = {
  zoom: 1 | 2;
  outputPath: (name: string) => string;
};

// The filter exists only in a populated list. These callers finish the real
// fixture run before opening Insights and retain the empty-session test separately.
async function checkPhoneInsightsFilter(
  page: Page,
  cssWidth: number,
  { zoom, outputPath }: PhoneFilterEvidence,
) {
  expect(cssWidth).toBe(390 / zoom);
  const showAll = page.getByRole("button", { name: "Show All", exact: true });
  await expect(showAll).toBeVisible();
  const geometry = await showAll.evaluate((element) => {
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
  await captureInspector(
    page,
    `${process.env.NAC_INSPECTOR_CONTROL_LABEL ?? "after"}-390-zoom${zoom}-insights-filter`,
  );
  await showAll.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Tools & reasoning", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(showAll).toBeFocused();
  const control = { name: "Show All", ...geometry };
  await fs.writeFile(
    outputPath(`phone-insights-filter-geometry-zoom${zoom}.json`),
    JSON.stringify(
      { physicalWidth: 390, cssWidth, nativeZoom: zoom, controls: [control] },
      null,
      2,
    ),
  );
  const detail = JSON.stringify({ zoom, width: cssWidth, ...control });
  expect.soft(control.rect.height, detail).toBeGreaterThanOrEqual(44);
  expect.soft(control.rect.width, detail).toBeGreaterThanOrEqual(44);
  expect.soft(control.rect.left, detail).toBeGreaterThanOrEqual(0);
  expect.soft(control.rect.right, detail).toBeLessThanOrEqual(cssWidth);
  expect.soft(control.rect.top, detail).toBeGreaterThanOrEqual(0);
  expect.soft(control.rect.bottom, detail).toBeLessThanOrEqual(900 / zoom);
  expect.soft(control.hit, detail).toBe(true);
}

async function openInsights(
  page: Page,
  baseUrl: string,
  parent: string,
  width: number,
  loadAll = false,
  phoneFilterEvidence?: PhoneFilterEvidence,
) {
  page.setDefaultTimeout(10_000);
  await page.goto(`${baseUrl}/#/session/${parent}/insights`);
  // Hash navigation can reuse the old document; every version/width starts fresh.
  await page.reload();
  if (width < 768) {
    await page.getByRole("button", { name: "Open panel", exact: true }).click();
  } else await showSidePanel(page);
  if (width >= 768 && width < 1280) {
    await page.getByRole("button", { name: "Open list", exact: true }).click();
  }
  if (phoneFilterEvidence) await checkPhoneInsightsFilter(page, width, phoneFilterEvidence);
  await page
    .getByRole("button", { name: width < 768 ? "Show All" : "All actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Tools & reasoning", exact: true }).click();
  if (loadAll) {
    const older = page.getByRole("button", { name: "Load older actions", exact: true });
    for (let pageIndex = 0; pageIndex < 4 && (await older.count()); pageIndex += 1) {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/sessions/${parent}/messages` &&
            response.request().method() === "GET" &&
            response.ok(),
        ),
        older.click(),
      ]);
      await expect(page.getByRole("button", { name: "Loading…", exact: true })).toHaveCount(0);
    }
    await expect(older).toHaveCount(0);
  }
  await page.getByRole("button", { name: /^Total activity:/, expanded: false }).click();
  await page.getByRole("button", { name: `${CHILD}, Check`, exact: true }).click();
  await expect(page.getByRole("group", { name: "Session status", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const view = globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } };
    await view.document.fonts.ready;
  });
}

for (const width of [1440, 768, 390]) {
  test(`restores exact Insights and child-page context at ${width}px`, async ({
    harness,
    page,
    request,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { parent, child } = await fixture(request, harness);
    const agentReadsBeforeUI = harness.provider.requests.length;
    const observed = await observeParentStream(page, harness.baseUrl, parent);
    const laterGate = new ScriptGate();
    try {
      await openInsights(
        page,
        harness.baseUrl,
        parent,
        width,
        false,
        width === 390 ? { zoom: 1, outputPath: (name) => info.outputPath(name) } : undefined,
      );
      if (width === 390) expect(harness.provider.requests).toHaveLength(agentReadsBeforeUI);
      await observed.ready();
      const status = page.getByRole("group", { name: "Session status", exact: true });
      const jump = status.getByRole("button", { name: CHILD, exact: true });
      let release!: () => void;
      const delayed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const childUrl = (url: URL) => url.pathname === `/sessions/${child}`;
      await page.route(childUrl, async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await delayed;
        await route.fulfill({ status: 503, body: "Controlled child snapshot unavailable" });
      });
      await jump.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/session/${parent}/delegated$`));
      const back = page.getByRole("button", { name: "Back to Insights", exact: true });
      try {
        await expect(back).toBeInViewport();
      } finally {
        release();
      }
      await expect(
        page.getByRole("alert").filter({ hasText: "Couldn’t load the child conversation." }),
      ).toBeVisible();
      await back.focus();
      await page.keyboard.press("Enter");
      await expect(status).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("region", { name: "Insights detail" })).toBeFocused();
      await page.unroute(childUrl);
      if (width < 1280) await jump.tap();
      else await jump.click();
      const composer = page
        .locator("form")
        .filter({ has: page.getByRole("switch", { name: "Run in the background" }) });
      const draft = composer.getByRole("textbox", { name: "Send a message" });
      await draft.fill("Keep this unsent parent-panel draft");
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/session/${child}/insights$`));
      await observed.absent();
      await page.getByRole("button", { name: /, parent chat$/i }).click();
      await expect(page).toHaveURL(new RegExp(`/session/${parent}/delegated$`));
      await expect(draft).toHaveValue("Keep this unsent parent-panel draft");
      await observed.ready();
      const laterRequestsStart = harness.provider.requests.length;
      harness.provider.enqueue(
        "inspector-later-stream",
        { token: "INSPECTOR_LATER_STREAM" },
        {
          kind: "text",
          stream: "request",
          reasoning: "A later run supplies new streaming activity.",
          text: "Later activity must not replace the saved origin.",
        },
        laterGate,
      );
      const later = await request.post(`${harness.baseUrl}/sessions/${parent}/runs`, {
        data: { prompt: "INSPECTOR_LATER_STREAM" },
      });
      expect(later.status()).toBe(202);
      await laterGate.accepted;
      const laterRequests = harness.provider.requests.slice(laterRequestsStart);
      expect(laterRequests.map((record) => record.matchedStep)).toEqual(["inspector-later-stream"]);
      expect(laterRequests[0].body).toMatchObject({ stream: true });
      await observed.sawReasoning("A later run supplies new streaming activity.");
      const pending = await request.get(`${harness.baseUrl}/sessions/${parent}`);
      const pendingBody = await pending.json();
      expect(pending.ok()).toBe(true);
      expect(pendingBody.active_run).toBeTruthy();
      expect(pendingBody.messages).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: "Later activity must not replace the saved origin.",
          }),
        ]),
      );
      laterGate.release();
      await waitForRunIdle(request, harness, parent);
      const settledParent = await request.get(`${harness.baseUrl}/sessions/${parent}`);
      expect(settledParent.ok()).toBe(true);
      expect((await settledParent.json()).messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: "Later activity must not replace the saved origin.",
          }),
        ]),
      );
      harness.provider.assertConsumed();
      await back.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/session/${parent}/insights$`));
      await expect(status).toHaveAttribute("aria-current", "true");
      if (width === 768) {
        await page.getByRole("tab", { name: "Insights" }).click();
        await expect(page.getByRole("button", { name: "Close list", exact: true })).toBeVisible();
        await page.getByRole("button", { name: `${CHILD}, Check`, exact: true }).click();
        await expect(status).toHaveAttribute("aria-current", "true");
      }
      expect(
        await page.evaluate(() => {
          const view = globalThis as unknown as {
            document: { documentElement: { scrollWidth: number } };
            innerWidth: number;
          };
          return view.document.documentElement.scrollWidth <= view.innerWidth;
        }),
      ).toBe(true);
    } finally {
      laterGate.release();
      await observed.close();
    }
  });
}

async function checkPhoneChildDisclosure(
  page: Page,
  cssWidth: number,
  label: string,
  outputPath: (name: string) => string,
) {
  const disclosure = page.getByRole("button", { name: `View full name: ${CHILD}`, exact: true });
  await expect(disclosure).toBeVisible();
  const geometry = await disclosure.evaluate((element) => {
    const view = globalThis as unknown as {
      getComputedStyle: (node: unknown) => {
        overflowX: string;
        overflowY: string;
        position: string;
      };
      document: { elementFromPoint: (x: number, y: number) => unknown };
    };
    const bounds = (node: typeof element) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const icon = element.querySelector("svg");
    const header = element.closest("header");
    if (!icon || !header) throw new Error("Child name disclosure lost its icon or header");
    const rect = bounds(element);
    const glyph = bounds(icon);
    const clips = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        clips.push({
          ...bounds(node),
          x: style.overflowX !== "visible",
          y: style.overflowY !== "visible",
        });
      }
    }
    const hit = view.document.elementFromPoint(
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
    );
    return {
      rect,
      glyph,
      clips,
      header: bounds(header),
      position: view.getComputedStyle(header).position,
      hit: hit === element || element.contains(hit),
    };
  });
  const detail = JSON.stringify({ cssWidth, ...geometry });
  expect(geometry.rect.width, detail).toBeGreaterThanOrEqual(44);
  expect(geometry.rect.height, detail).toBeGreaterThanOrEqual(44);
  expect(geometry.rect.left, detail).toBeGreaterThanOrEqual(0);
  expect(geometry.rect.right, detail).toBeLessThanOrEqual(cssWidth);
  expect(geometry.hit, detail).toBe(true);
  expect(geometry.position, detail).toBe("relative");
  for (const clip of [geometry.rect, ...geometry.clips]) {
    if (!("x" in clip) || clip.x) {
      expect(geometry.glyph.left, detail).toBeGreaterThanOrEqual(clip.left);
      expect(geometry.glyph.right, detail).toBeLessThanOrEqual(clip.right);
    }
    if (!("y" in clip) || clip.y) {
      expect(geometry.glyph.top, detail).toBeGreaterThanOrEqual(clip.top);
      expect(geometry.glyph.bottom, detail).toBeLessThanOrEqual(clip.bottom);
    }
  }
  const open = page.getByRole("button", { name: "Open", exact: true });
  const targets = [];
  for (const control of [
    open,
    page.getByRole("button", { name: "Open list", exact: true }),
    page.getByRole("button", { name: "Back to Insights", exact: true }),
  ]) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const target = await control.evaluate((element) => {
      const view = globalThis as unknown as {
        document: { elementFromPoint: (x: number, y: number) => unknown };
      };
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      const hit = view.document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return {
        left,
        right,
        top,
        bottom,
        width,
        height,
        hit: hit === element || element.contains(hit),
      };
    });
    targets.push(target);
    expect(target.width, detail).toBeGreaterThanOrEqual(44);
    expect(target.height, detail).toBeGreaterThanOrEqual(44);
    expect(target.hit, detail).toBe(true);
  }
  await fs.writeFile(
    outputPath(`${label}-child-disclosure.json`),
    JSON.stringify({ ...geometry, targets }, null, 2),
  );
  const openRect = await open.boundingBox();
  if (!openRect) throw new Error("Child Open action has no box");
  if (cssWidth < 280) expect(openRect.y).toBeGreaterThanOrEqual(geometry.rect.bottom);
  else expect(openRect.y).toBeLessThan(geometry.rect.bottom);
  const url = page.url();
  await disclosure.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Full session name", exact: true });
  await expect(dialog.locator("[data-full-session-name]")).toHaveText(CHILD);
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await captureInspector(page, `${label}-child-full-name`);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(disclosure).toBeFocused();
  await disclosure.tap();
  await expect(dialog.locator("[data-full-session-name]")).toHaveText(CHILD);
  await page.keyboard.press("Escape");
  await expect(disclosure).toBeFocused();
  expect(page.url()).toBe(url);
}

test("captures matched production inspector detail, subagents and file views", async ({
  harness,
  context,
  request,
}, info) => {
  test.setTimeout(120_000);
  test.skip(!process.env.NAC_INSPECTOR_CAPTURE_DIR, "Explicit evidence capture only");
  const { parent } = await fixture(request, harness);
  for (const version of captureVersions) {
    const page = await context.newPage();
    try {
      await serveInspectorVersion(page, harness.baseUrl, version);
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await openInsights(page, harness.baseUrl, parent, width);
        await captureInspector(page, `${version}-${width}-insights-detail`);
        await page
          .getByRole("group", { name: "Session status", exact: true })
          .getByRole("button", { name: CHILD, exact: true })
          .click();
        await readyInspectorChild(
          page,
          width,
          "The child inspected the captured changes. No files were modified.",
        );
        await captureInspector(page, `${version}-${width}-subagents-detail`);
        if (version === "after" && width === 390) {
          await checkPhoneChildDisclosure(page, width, "after-390-native", (name) =>
            info.outputPath(name),
          );
        }
        if (width < 768) await page.getByRole("button", { name: "Open list", exact: true }).click();
        await page.getByRole("tab", { name: "Files", exact: true }).click();
        await readyInspectorFiles(page, width);
        await captureInspector(page, `${version}-${width}-files-list`);
      }
    } finally {
      // A queued request belongs to this page until it is closed, never the next version.
      await page.close();
    }
  }
});

type ZoomRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  width: number;
};

async function measureZoomGeometry(
  page: Page,
  version: InspectorVersion,
  width: number,
  cssWidth: number,
) {
  const measure = async (control: Locator) =>
    control.evaluate((element) => {
      const view = globalThis as unknown as {
        innerHeight: number;
        document: { elementFromPoint: (x: number, y: number) => unknown };
      };
      const rect = element.getBoundingClientRect() as ZoomRect;
      const header = element.closest("header")?.getBoundingClientRect() as ZoomRect | undefined;
      const hit = view.document.elementFromPoint(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2,
      );
      const toRect = (box: ZoomRect) => ({
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        width: box.width,
      });
      return {
        rect: toRect(rect),
        header: header ? toRect(header) : toRect(rect),
        hit: hit === element || element.contains(hit),
        innerHeight: view.innerHeight,
      };
    });
  const open = page.getByRole("button", { name: "Open", exact: true });
  const firstLine = await page
    .getByRole("dialog", { name: "Subagents", exact: true })
    .getByText("The child inspected the captured changes. No files were modified.", { exact: true })
    .evaluate((element) => {
      const view = globalThis as unknown as {
        document: {
          createRange: () => {
            selectNodeContents: (node: unknown) => void;
            getClientRects: () => ArrayLike<ZoomRect>;
          };
        };
      };
      const range = view.document.createRange();
      range.selectNodeContents(element);
      const first = Array.from(range.getClientRects()).find(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      if (!first) throw new Error("Child response has no rendered first line");
      return {
        left: first.left,
        right: first.right,
        top: first.top,
        bottom: first.bottom,
        height: first.height,
        width: first.width,
      };
    });
  const openMeasurement = await measure(open);
  const result = {
    version,
    physicalWidth: width,
    cssWidth,
    innerHeight: openMeasurement.innerHeight,
    nativeZoomVerifiedByBrowserHelper: 2,
    open: openMeasurement,
    back:
      version === "after"
        ? await measure(page.getByRole("button", { name: "Back to Insights", exact: true }))
        : null,
    list: await measure(page.getByRole("button", { name: "Open list", exact: true })),
    firstLine,
  };
  await open.focus();
  await expect(open).toBeFocused();
  return result;
}

test("keeps inspector return controls reachable at actual 200 percent browser zoom", async ({
  harness,
  request,
}, info) => {
  test.setTimeout(120_000);
  const { parent, child } = await fixture(request, harness);
  const agentReadsBeforeUI = harness.provider.requests.length;
  const measured: Awaited<ReturnType<typeof measureZoomGeometry>>[] = [];
  let readingGestures = 0;
  for (const version of captureVersions) {
    const { context, page } = await inspectorZoomBrowser(
      (name) => info.outputPath(`${version}-${name}`),
      harness.baseUrl,
      version,
    );
    try {
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const cssWidth = await page.evaluate(
          () => (globalThis as unknown as { innerWidth: number }).innerWidth,
        );
        expect(cssWidth).toBe(width / 2);
        await openInsights(
          page,
          harness.baseUrl,
          parent,
          cssWidth,
          false,
          version === "after" && width === 390
            ? { zoom: 2, outputPath: (name) => info.outputPath(name) }
            : undefined,
        );
        if (version === "after" && width === 390)
          expect(harness.provider.requests).toHaveLength(agentReadsBeforeUI);
        await captureInspector(page, `${version}-${width}-zoom200-insights`);
        await page
          .getByRole("group", { name: "Session status", exact: true })
          .getByRole("button", { name: CHILD, exact: true })
          .click();
        await readyInspectorChild(
          page,
          cssWidth,
          "The child inspected the captured changes. No files were modified.",
        );
        await expect(page.getByRole("button", { name: "Open", exact: true })).toBeInViewport();
        await captureInspector(page, `${version}-${width}-zoom200-subagents`);
        const geometry = await measureZoomGeometry(page, version, width, cssWidth);
        measured.push(geometry);
        await fs.writeFile(
          info.outputPath(`${version}-${width}-zoom200-geometry.json`),
          JSON.stringify(geometry, null, 2),
        );
        if (version === "after") {
          if (width === 390) {
            await checkPhoneChildDisclosure(page, cssWidth, "after-390-zoom200", (name) =>
              info.outputPath(name),
            );
          }
          for (const control of [geometry.open, geometry.back, geometry.list]) {
            if (!control) throw new Error("Candidate return control is missing");
            expect(control.rect.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
            expect(control.rect.right, JSON.stringify(geometry)).toBeLessThanOrEqual(
              geometry.cssWidth,
            );
            expect(control.rect.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
            expect(control.rect.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(
              geometry.innerHeight,
            );
            expect(control.rect.height, JSON.stringify(geometry)).toBeGreaterThanOrEqual(44);
            expect(control.hit, JSON.stringify(geometry)).toBe(true);
          }
          if (
            await assertInspectorReadable(
              page,
              (name) => info.outputPath(name),
              `${version}-${width}`,
              readingGestures === 0,
              width / cssWidth,
            )
          )
            readingGestures += 1;
          const back = page.getByRole("button", { name: "Back to Insights" });
          await expect(back).toBeInViewport();
          await back.click();
          await expect(
            page.getByRole("group", { name: "Session status", exact: true }),
          ).toHaveAttribute("aria-current", "true");
        }
      }
      if (version === "after") {
        await page
          .getByRole("group", { name: "Session status", exact: true })
          .getByRole("button", { name: CHILD, exact: true })
          .click();
        await readyInspectorChild(
          page,
          195,
          "The child inspected the captured changes. No files were modified.",
        );
        const open = page.getByRole("button", { name: "Open", exact: true });
        await open.focus();
        await expect(open).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(`/session/${child}/insights$`));
        await page.getByRole("button", { name: /, parent chat$/i }).click();
        await expect(page).toHaveURL(new RegExp(`/session/${parent}/delegated$`));
        const back = page.getByRole("button", { name: "Back to Insights", exact: true });
        await back.focus();
        await expect(back).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("group", { name: "Session status", exact: true }),
        ).toHaveAttribute("aria-current", "true");
        await expect(page.getByRole("region", { name: "Insights detail" })).toBeFocused();
      }
    } finally {
      await context.close();
    }
  }
});

async function listPosition(row: Locator, top?: number) {
  return row.evaluate((element, next) => {
    const view = globalThis as unknown as {
      getComputedStyle: (element: unknown) => { overflowY: string };
    };
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (!["auto", "scroll"].includes(view.getComputedStyle(node).overflowY)) continue;
      if (next != null) node.scrollTop = next;
      return {
        top: node.scrollTop,
        offset: element.getBoundingClientRect().top - node.getBoundingClientRect().top,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    }
    throw new Error("Insights row has no vertical scroller");
  }, top ?? null);
}

test("retains the original long-list row offset across a new streamed turn without duplicate parent reads", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { parent } = await fixture(request, harness, true);
  const observed = await observeParentStream(page, harness.baseUrl, parent);
  const prependGate = new ScriptGate();
  try {
    let parentReads = 0;
    page.on("request", (read) => {
      if (read.method() === "GET" && new URL(read.url()).pathname === `/sessions/${parent}`)
        parentReads += 1;
    });
    await openInsights(page, harness.baseUrl, parent, 1440, true);
    const row = page.getByRole("button", { name: `${CHILD}, Check`, exact: true });
    const original = await listPosition(row, 220);
    expect(original.scrollHeight).toBeGreaterThan(original.clientHeight + 220);
    await expect.poll(async () => (await listPosition(row)).top).toBe(220);
    const status = page.getByRole("group", { name: "Session status", exact: true });
    await status.getByRole("button", { name: CHILD, exact: true }).click();
    await expect(page.getByRole("button", { name: "Back to Insights" })).toBeVisible();
    await observed.ready();
    const prependRequestsStart = harness.provider.requests.length;
    harness.provider.enqueue(
      "inspector-prepended-turn",
      { token: "INSPECTOR_PREPEND" },
      {
        kind: "text",
        stream: "request",
        reasoning: "A new turn arrived above the retained inspection.",
        text: "The new turn must preserve the original list position.",
      },
      prependGate,
    );
    const run = await request.post(`${harness.baseUrl}/sessions/${parent}/runs`, {
      data: { prompt: "INSPECTOR_PREPEND" },
    });
    expect(run.status()).toBe(202);
    await prependGate.accepted;
    const prependRequests = harness.provider.requests.slice(prependRequestsStart);
    expect(prependRequests.map((record) => record.matchedStep)).toEqual([
      "inspector-prepended-turn",
    ]);
    expect(prependRequests[0].body).toMatchObject({ stream: true });
    await observed.sawReasoning("A new turn arrived above the retained inspection.");
    const pending = await request.get(`${harness.baseUrl}/sessions/${parent}`);
    const pendingBody = await pending.json();
    expect(pending.ok()).toBe(true);
    expect(pendingBody.active_run).toBeTruthy();
    expect(pendingBody.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "The new turn must preserve the original list position.",
        }),
      ]),
    );
    // Final stream text can precede the debounced canonical browser snapshot.
    const browserSettledParent = page.waitForResponse(async (response) => {
      const url = new URL(response.url());
      if (
        response.request().method() !== "GET" ||
        url.origin !== new URL(harness.baseUrl).origin ||
        url.pathname !== `/sessions/${parent}` ||
        response.status() !== 200
      )
        return false;
      try {
        const body = await response.json();
        return (
          body.active_run == null &&
          Array.isArray(body.messages) &&
          body.messages.some(
            (message: { role?: string; content?: unknown }) =>
              message.role === "assistant" &&
              message.content === "The new turn must preserve the original list position.",
          )
        );
      } catch {
        // A superseded or aborted snapshot cannot establish this boundary.
        return false;
      }
    });
    prependGate.release();
    const browserParentResponse = await browserSettledParent;
    expect(await browserParentResponse.finished()).toBeNull();
    await waitForRunIdle(request, harness, parent);
    const settledParent = await request.get(`${harness.baseUrl}/sessions/${parent}`);
    expect(settledParent.ok()).toBe(true);
    expect((await settledParent.json()).messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "The new turn must preserve the original list position.",
        }),
      ]),
    );
    await expect(
      page.getByText("The new turn must preserve the original list position.", { exact: true }),
    ).toBeVisible();
    const readsBeforeReturn = parentReads;
    await page.getByRole("button", { name: "Back to Insights" }).click();
    await expect(status).toHaveAttribute("aria-current", "true");
    await expect(row).toHaveAttribute("aria-pressed", "true");
    const restored = await listPosition(row);
    expect(Math.abs(restored.offset - original.offset)).toBeLessThanOrEqual(1);
    expect(restored.top).toBeGreaterThan(original.top);
    await expect(
      page
        .getByRole("group", { name: "Show:" })
        .getByRole("button", { name: "Tools & reasoning", exact: true }),
    ).toBeVisible();
    expect(parentReads).toBe(readsBeforeReturn);
    harness.provider.assertConsumed();
    await captureInspector(page, "after-1440-long-list-prepended-return");
  } finally {
    prependGate.release();
    await observed.close();
  }
});
