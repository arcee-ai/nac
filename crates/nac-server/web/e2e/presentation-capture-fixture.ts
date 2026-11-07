import fs from "node:fs/promises";
import type { Locator } from "@playwright/test";
import { expect, startForegroundChild, waitForRunIdle } from "./harness";
import { frontendHash } from "./frontend-assets";
import type { ManagedSessionSummary } from "../src/app/types/api";
import {
  primaryModelTrigger,
  revealDesktopSidebar,
  type Journey,
} from "./presentation-composed-fixture";

export type CaptureJourney = Journey & { notes: string[]; legacyFrontend: boolean };
const childTitle = "Inspect the composed artifact and retain the complete parent context";

async function click(control: Locator) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  await control.click();
}
async function menu(j: CaptureJourney, name: RegExp) {
  if (j.width < 768)
    await click(j.root.getByRole("button", { name: "Open the menu", exact: true }));
  else await revealDesktopSidebar(j.root);
  await click(j.root.getByRole("button", { name }).first());
}

/** Observe the actual old view, without requiring the new behavior or geometry. */
export async function captureView(j: CaptureJourney, state: string, provenance: unknown) {
  await j.root.evaluate(async (node) => {
    const doc = node.ownerDocument,
      view = doc.defaultView!;
    await doc.fonts.ready;
    await new Promise<void>((done) =>
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => done())),
    );
  });
  const environment = await j.root.evaluate((node) => {
    const doc = node.ownerDocument,
      view = doc.defaultView!;
    const fonts: { family: string; status: string }[] = [];
    doc.fonts.forEach((font: { family: string; status: string }) =>
      fonts.push({ family: font.family, status: font.status }),
    );
    return {
      width: view.innerWidth,
      height: view.innerHeight,
      dpr: view.devicePixelRatio,
      theme:
        node.getAttribute("data-theme") ??
        node.querySelector("[data-nac-runtime]")?.getAttribute("data-theme"),
      reducedMotion: view.matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollY: view.scrollY,
      documentWidth: doc.documentElement.scrollWidth,
      fonts,
      fontRequests: view.performance
        .getEntriesByType("resource")
        .filter((entry: { name: string }) => /\.(woff2?|ttf)(\?|$)/.test(entry.name))
        .map((entry: { name: string }) => entry.name),
      scrollContainers: Array.from<{ scrollTop: number; clientHeight: number }>(
        node.querySelectorAll("*"),
      )
        .filter((entry) => entry.scrollTop !== 0)
        .map((entry) => ({ top: entry.scrollTop, height: entry.clientHeight })),
    };
  });
  expect(environment.width).toBe(j.width);
  if (j.width === 195) expect(environment.dpr).toBe(2);
  const cdp = await j.page.context().newCDPSession(j.page);
  let bytes: Buffer;
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    bytes = Buffer.from(frame.data, "base64");
  } finally {
    await cdp.detach();
  }
  const file = j.info.outputPath(`${state}.png`);
  await fs.writeFile(file, bytes);
  await j.info.attach(state, { path: file, contentType: "image/png" });
  await j.info.attach(`${state}-semantics`, {
    body: await j.root.ariaSnapshot(),
    contentType: "text/plain",
  });
  const sessions = await j.request.get(`${j.harness.baseUrl}/sessions`);
  expect(sessions.ok()).toBe(true);
  const opaqueRuntimeMetadata = ((await sessions.json()) as ManagedSessionSummary[]).map(
    ({ summary }) => ({
      session_id: summary.session_id,
      project_id: summary.project_id,
      created_at: summary.created_at,
      updated_at: summary.updated_at,
    }),
  );
  await j.info.attach(`${state}-receipt`, {
    contentType: "application/json",
    body: JSON.stringify({
      provenance,
      environment,
      opaqueRuntimeMetadata,
      observedAt: new Date().toISOString(),
      fixtureMatching:
        "Scripted visible inputs are shared; generated identifiers/timestamps are recorded separately without masking",
      png: {
        sha256: frontendHash(bytes),
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      },
      notes: [...j.notes],
      status: j.notes.some((note) => /^(expected-old-failure|unreachable|View-only)/.test(note))
        ? "observation-with-gaps"
        : "view-captured-not-qualification",
    }),
  });
}

export async function launchView(j: CaptureJourney, capture: () => Promise<void>) {
  const start = j.root.getByRole("button", { name: "Get Started", exact: true });
  if (await start.isVisible()) await click(start);
  else await menu(j, /^New project$/i);
  j.fixture.catalogGate.release();
  const form = j.root.getByRole("dialog", { name: "New Project", exact: true });
  const model = primaryModelTrigger(form, j.legacyFrontend);
  await click(model);
  const search = j.root.getByPlaceholder("Search models…");
  await search.fill("gpt-5.6-sol");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(model).toHaveAttribute("aria-expanded", "false");
  const title = form.getByRole("textbox", {
    name: j.legacyFrontend ? "Taken from the git remote" : "Project name",
    exact: true,
  });
  await expect(title).toHaveCount(1);
  await title.fill("Composed qualification project");
  const launch = form.getByRole("button", { name: "Create Project", exact: true });
  if (j.width === 768) {
    const message = "Choose a valid Git working folder. (HTTP 400)";
    const error = j.legacyFrontend
      ? form.getByText(message, { exact: true })
      : form.getByRole("alert");
    await click(launch);
    await expect(error).toBeVisible();
    await expect(error).toHaveText(message);
    await expect(launch).toBeDisabled();
    expect(j.fixture.state.projectAttempts).toBe(1);
    expect(j.fixture.state.sessionCreates).toBe(0);
    // An actual public edit clears the previous request error on D481 and F.
    await title.fill("Composed qualification project / retry");
    await expect(error).toHaveCount(0);
  }
  await expect(launch).toBeEnabled();
  const response = j.page.waitForResponse(
    (reply) =>
      j.fixture.resource(new URL(reply.url())) === "/sessions" &&
      reply.request().method() === "POST",
  );
  await click(launch);
  try {
    await expect.poll(() => j.fixture.state.projectPending).toBe(true);
    await expect(launch).toBeDisabled();
    expect(j.fixture.state.projectAttempts).toBe(j.width === 768 ? 2 : 1);
    expect(j.fixture.state.sessionCreates).toBe(0);
    await capture();
  } finally {
    j.fixture.projectGate.release();
  }
  const accepted = await response;
  expect(accepted.ok()).toBe(true);
  const id = ((await accepted.json()) as { metadata: { session_id: string } }).metadata.session_id;
  expect(j.fixture.state.sessionCreates).toBe(1);
  await expect(form).toHaveCount(0);
  return id;
}

export async function seedReading(j: CaptureJourney, id: string) {
  j.harness.provider.enqueue(
    "capture-reading",
    { token: "COMPOSED_QUALIFICATION_REASONING" },
    {
      kind: "text",
      reasoning:
        "Read the selected state before acting.\n\nKeep the parent and sibling contexts independent.",
      text: "The exact composed artifact preserved the selected workflow.",
    },
  );
  const response = await j.request.post(`${j.harness.baseUrl}/sessions/${id}/runs`, {
    data: { prompt: "COMPOSED_QUALIFICATION_REASONING" },
  });
  expect(response.status()).toBe(202);
  await waitForRunIdle(j.request, j.harness, id);
  await j.root
    .getByRole("combobox", { name: "Message", exact: true })
    .fill("Unsent parent chat draft survives settings and managed setup");
}

export async function settingsView(
  j: CaptureJourney,
  capture: () => Promise<void>,
  stopAtDraft = false,
) {
  await click(j.root.getByRole("button", { name: "Session settings", exact: true }));
  const modal = j.root.getByRole("dialog", { name: "Session settings", exact: true });
  await modal
    .getByRole("textbox", { name: "Session title", exact: true })
    .fill("Composed settings saved");
  await click(modal.getByText("Advanced execution settings", { exact: true }));
  await click(modal.getByRole("button", { name: "Advanced Configurations", exact: true }));
  await modal.getByRole("textbox", { name: "Context limit", exact: true }).fill("48000");
  if (j.width === 768) {
    await click(modal.getByRole("button", { name: "Save", exact: true }));
    await expect(modal.getByRole("alert")).toContainText("Configured Deny");
  }
  await capture();
  if (stopAtDraft) return;
  await click(modal.getByRole("button", { name: "Save", exact: true }));
  await expect(modal).toHaveCount(0);
}

export async function managedView(j: CaptureJourney, capture: () => Promise<void>) {
  j.fixture.state.managed = true;
  j.fixture.state.connected = true;
  await menu(j, /^(Managed host|Manage Host)$/);
  const modal = j.root.getByRole("dialog", { name: "Managed host", exact: true });
  await expect(modal.getByTestId("managed-host-status")).toContainText(
    "Controlled host readiness",
    { timeout: 25_000 },
  );
  await click(modal.getByRole("button", { name: "secrets", exact: true }));
  const name = modal.getByLabel("Variable name", { exact: true });
  const value = modal.getByLabel("New value", { exact: true });
  await name.fill("QUALIFICATION_SUBMITTED");
  await value.fill("synthetic-dummy-value");
  await click(modal.getByRole("button", { name: "Save secret", exact: true }));
  try {
    await expect.poll(() => j.fixture.state.secretPending).toBe(true);
    if (j.width <= 390) {
      await name.fill("QUALIFICATION_NEWER_DRAFT");
      await value.fill("synthetic-newer-dummy");
      await name.fill("QUALIFICATION_SUBMITTED");
      await name.fill("QUALIFICATION_NEWER_DRAFT");
    }
  } finally {
    j.fixture.secretGate.release();
  }
  await expect(modal.getByText("QUALIFICATION_SUBMITTED", { exact: true })).toBeVisible();
  if (j.width <= 390 && (await name.inputValue()) !== "QUALIFICATION_NEWER_DRAFT")
    j.notes.push("expected-old-failure: newer secret draft erased; not refilled");
  await capture();
  await click(modal.getByRole("button", { name: "Close", exact: true }));
  await expect(modal).toHaveCount(0);
}

export async function inspectorView(j: CaptureJourney, id: string) {
  j.harness.provider.enqueue(
    "capture-child",
    { token: "COMPOSED_CHILD" },
    { kind: "text", text: "Child inspection complete without modifying files." },
  );
  const reply = await startForegroundChild(j.request, j.harness, id, childTitle, "COMPOSED_CHILD");
  expect(reply.ok()).toBe(true);
  const child = ((await reply.json()) as { child_session_id: string }).child_session_id;
  j.harness.provider.enqueue(
    "capture-status",
    { token: "COMPOSED_PARENT_STATUS" },
    {
      kind: "function_call",
      name: "subagent_status",
      stream: "request",
      callId: "composed-status",
      arguments: { child_session_id: child, _nac: null },
    },
  );
  j.harness.provider.enqueue(
    "capture-files",
    { functionOutputCallId: "composed-status" },
    {
      kind: "function_call",
      name: "glob",
      stream: "request",
      callId: "composed-files",
      arguments: { pattern: "*.txt" },
    },
  );
  j.harness.provider.enqueue(
    "capture-finished",
    { functionOutputCallId: "composed-files" },
    { kind: "text", stream: "request", text: "Composed parent origin retained." },
  );
  const response = await j.request.post(`${j.harness.baseUrl}/sessions/${id}/runs`, {
    data: { prompt: "COMPOSED_PARENT_STATUS" },
  });
  expect(response.status()).toBe(202);
  await waitForRunIdle(j.request, j.harness, id);
  j.harness.provider.enqueue(
    "capture-later",
    { token: "COMPOSED_LATER" },
    {
      kind: "text",
      stream: "request",
      reasoning: "Later activity retains the original parent origin.",
      text: "Later activity settled.",
    },
  );
  const later = await j.request.post(`${j.harness.baseUrl}/sessions/${id}/runs`, {
    data: { prompt: "COMPOSED_LATER" },
  });
  expect(later.status()).toBe(202);
  await waitForRunIdle(j.request, j.harness, id);
  if (j.width < 768) await click(j.root.getByRole("button", { name: "Open panel", exact: true }));
  const show = j.root.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await click(show);
  const insights = j.root.getByRole("tab", { name: "Insights", exact: true });
  await click(insights);
  const list = j.root.getByRole("button", { name: "Open list", exact: true });
  if (await list.isVisible()) await click(list);
  await click(
    j.root.getByRole("button", { name: j.width < 768 ? "Show All" : "All actions", exact: true }),
  );
  await click(j.root.getByRole("button", { name: "Tools & reasoning", exact: true }));
  // Chat badges and singleton rows share this label. Only the public list's
  // expandable action group owns aria-expanded and the child-status segments.
  const group = j.root
    .getByRole("button", { name: /^Total activity:/ })
    .and(j.root.locator("button[aria-expanded]"));
  await expect(group).toHaveCount(1);
  if ((await group.getAttribute("aria-expanded")) === "false") await click(group);
  const selected = j.root.getByRole("button", { name: `${childTitle}, Check`, exact: true });
  await click(selected);
  j.notes.push(
    "View-only baseline: parent return is not re-enacted; actual public Insights/status selection establishes this visible view",
  );
}

export async function designView(
  j: CaptureJourney,
  expected: "Buttons" | "Selected presentation journeys",
) {
  await click(j.root.getByRole("button", { name: "Settle reasoning", exact: true }));
  const heading = j.root.getByText("Conversation: reasoning and answer", { exact: true });
  await heading.scrollIntoViewIfNeeded();
  const measure = () =>
    heading.evaluate((node) => {
      const common = node.parentElement!.parentElement!,
        next = common.nextElementSibling!;
      const view = node.ownerDocument.defaultView!;
      let container = common.parentElement!;
      while (
        container.parentElement &&
        !/auto|scroll/.test(view.getComputedStyle(container).overflowY)
      )
        container = container.parentElement;
      const bounds = (element: typeof next) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        };
      };
      return {
        common: bounds(common),
        scrollContainer: bounds(container),
        scrollTop: container.scrollTop,
        nextHeading: next.firstElementChild?.firstElementChild?.textContent?.trim(),
        nextHeadingBounds: bounds(next.firstElementChild!.firstElementChild!),
      };
    });
  const before = await measure();
  expect(before.nextHeading).toBe(expected);
  const bounds = before.scrollContainer;
  await j.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(bounds.height / 2, 300));
  await j.page.mouse.wheel(0, before.nextHeadingBounds.y - bounds.y);
  await expect(j.root.getByText(expected, { exact: true })).toBeInViewport();
  const after = await measure();
  expect(after.nextHeading).toBe(expected);
  await j.info.attach("design-common-anchor", {
    contentType: "application/json",
    body: JSON.stringify({ expected, before, after }),
  });
}
