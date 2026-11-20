import type { Locator, Page } from "@playwright/test";

import { expect, showSidePanel } from "./harness";

/**
 * A transcript step paused before execution. Steps waiting for approval stay
 * pinned under their turn's folded work line whatever the fold says.
 */
export function stepAwaitingApproval(page: Page): Locator {
  return page.getByRole("button", { name: /Waiting for approval$/ });
}

/** A settled turn's work line, e.g. "Worked for 1.2s · Ran 1 command". */
export function settledWorkFold(page: Page, sentence: string): Locator {
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", { name: new RegExp(`^Worked for \\S+ · ${escaped}`) });
}

/** The whole fold (line, steps, links) a work line belongs to. */
export function workFoldOf(page: Page, line: Locator): Locator {
  return page.locator("[data-work-fold]").filter({ has: line });
}

/** Expands a work line in place, unless it already is. */
export async function expandWorkFold(line: Locator) {
  await expect(line).toBeVisible();
  if ((await line.getAttribute("aria-expanded")) !== "true") await line.click();
  await expect(line).toHaveAttribute("aria-expanded", "true");
}

/** Opens a turn's work in Insights from its expanded work line. */
export async function openWorkInInsights(page: Page, line: Locator) {
  await expandWorkFold(line);
  await workFoldOf(page, line)
    .getByRole("button", { name: "Open in Insights", exact: true })
    .click();
}

/** The session drawer's panel tabs (desktop). */
export function sessionPanelTabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Session panels" });
}

/** Opens the desktop session drawer through its header toggle. */
export async function openSessionDrawer(page: Page) {
  await showSidePanel(page);
}

/** Opens one panel of the desktop session drawer by its tab. */
export async function openSessionPanel(page: Page, name: string) {
  await openSessionDrawer(page);
  const tab = sessionPanelTabs(page).getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Opens the drawer and verifies the available desktop space lets it dock. */
export async function dockSessionDrawer(page: Page) {
  await showSidePanel(page);
  await expect(
    page.getByRole("complementary").filter({ has: sessionPanelTabs(page) }),
  ).toBeVisible();
}

/** Home's hero composer: the app's one new-session flow. */
export function homeComposer(page: Page): Locator {
  return page.getByRole("textbox", { name: "What should we work on?" });
}

/** Opens the connected-provider model list from the composer chip. */
export async function openModelList(scope: Page | Locator): Promise<Locator> {
  await scope.getByRole("button", { name: /^(Model: |Choose a model$)/ }).click();
  await scope
    .getByRole("dialog", { name: "Model settings", exact: true })
    .getByRole("button", { name: /^Choose model/ })
    .click();
  const list = scope.getByRole("menu", { name: "Model", exact: true });
  await expect(list).toBeVisible();
  return list;
}

/** Opens the still-supported launch options for orchestration-capable builds. */
export async function openAdvancedModelOptions(page: Page): Promise<Locator> {
  await openModelList(page);
  await page.getByRole("menuitem", { name: "Light model and presets…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Model", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export type BehaviorLabel = "Agent" | "Agent + Orchestrator" | "Orchestrator";

/** One choice of Home's behavior menu, by its display label. */
export function behaviorChoice(page: Page, label: BehaviorLabel): Locator {
  return page.getByRole("menuitemradio").filter({ has: page.getByText(label, { exact: true }) });
}

/** Picks the immutable behavior for the next session from Home's behavior chip. */
export async function chooseBehavior(page: Page, label: BehaviorLabel) {
  await page.getByRole("button", { name: /^Behavior: / }).click();
  await behaviorChoice(page, label).click();
  await expect(page.getByRole("button", { name: `Behavior: ${label}`, exact: true })).toBeVisible();
}

/** Sends Home's prompt as a new session's first run and returns the opened session. */
export async function startSessionFromHome(
  page: Page,
  prompt: string,
  options: { runAdmission?: "aborted" | "busy" } = {},
): Promise<string> {
  const before = page.url();
  await homeComposer(page).fill(prompt);
  // Home navigates after creation; its owning composer submits only after the
  // interactive stream is ready. A route alone is not first-run admission.
  const matches = (request: import("@playwright/test").Request) =>
    request.method() === "POST" &&
    /\/sessions\/[^/]+\/runs$/.test(new URL(request.url()).pathname) &&
    request.postDataJSON()?.prompt === prompt;
  // Hosted-provider configuration checks deliberately abort admission before
  // any network effect; successful and known-rejection journeys await a receipt.
  const firstRun = page.waitForRequest(matches);
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect.poll(() => page.url()).not.toBe(before);
  await expect(page).toHaveURL(/\/session\/[^/]+\/insights$/);
  const sessionId = page.url().match(/\/session\/([^/]+)\//)?.[1];
  expect(sessionId).toBeTruthy();
  const attempted = await firstRun;
  expect(new URL(attempted.url()).pathname).toBe(`/sessions/${sessionId}/runs`);
  const receipt = await attempted.response();
  if (options.runAdmission === "aborted") expect(receipt).toBeNull();
  else expect(receipt?.status()).toBe(options.runAdmission === "busy" ? 409 : 202);
  return decodeURIComponent(sessionId!);
}

/** Opens the goal editor from the composer's `+` menu, by the goal row's name. */
export async function openGoalFromComposerMenu(page: Page, name: string) {
  const add = page.getByRole("button", { name: "Add to message", exact: true });
  if ((await add.getAttribute("aria-expanded")) !== "true") await add.click();
  await page
    .getByRole("group", { name: "Add to message" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** Closes the session drawer, floating or docked, by its Hide panel button. */
export async function hideSessionDrawer(page: Page) {
  const tabs = sessionPanelTabs(page);
  if (!(await tabs.isVisible())) return;
  await page.getByRole("button", { name: "Hide panel", exact: true }).first().click();
  await expect(tabs).toBeHidden();
}

/** A phone's one "Open panel" sheet, listing the session's panels as rows. */
export async function openPhonePanelSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: "Session", exact: true });
  await page.getByRole("button", { name: "Open panel", exact: true }).click();
  await expect(sheet).toBeVisible();
  return sheet;
}
