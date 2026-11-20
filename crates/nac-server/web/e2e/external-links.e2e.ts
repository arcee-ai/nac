import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";

import { createDirectSession, createProject, expect, test, type EmbeddedHarness } from "./harness";
import { openSettingsSection } from "./settings-focus";

function linkBrowserEvents(page: Page) {
  const events: Array<Record<string, unknown>> = [];
  page.on("console", (message) => {
    events.push({ kind: "console", type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    events.push({ kind: "pageerror", message: error.message });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url());
      events.push({
        kind: "http-error",
        origin: url.origin,
        path: url.pathname,
        status: response.status(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    events.push({
      kind: "requestfailed",
      origin: url.origin,
      path: url.pathname,
      error: request.failure()?.errorText,
    });
  });
  return events;
}

async function attachLinkBrowserEvents(info: TestInfo, events: Array<Record<string, unknown>>) {
  await info.attach("external-link browser console and request failures", {
    body: JSON.stringify(events, null, 2),
    contentType: "application/json",
  });
}

async function linkSession(request: APIRequestContext, harness: EmbeddedHarness) {
  const id = await createDirectSession(request, harness);
  const titled = await request.put(`${harness.baseUrl}/sessions/${id}/presentation`, {
    data: { title: "External links fixture", pinned: false, expected_version: 0 },
  });
  expect(titled.ok()).toBe(true);
  return id;
}

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  controls: Locator,
  events: Array<Record<string, unknown>>,
) {
  await attachLinkBrowserEvents(info, events);
  await page.evaluate(() =>
    (
      globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
    ).document.fonts.ready.then(() => undefined),
  );
  const screenshot = info.outputPath(name);
  await page.screenshot({ path: screenshot, animations: "disabled", caret: "hide" });
  await info.attach(name, { path: screenshot, contentType: "image/png" });
  const cropName = name.replace(".png", "-controls.png");
  const crop = info.outputPath(cropName);
  await controls.screenshot({ path: crop, animations: "disabled", caret: "hide" });
  await info.attach(cropName, { path: crop, contentType: "image/png" });
}

async function followWithKeyboard(page: Page, link: Locator, destination: string) {
  await expect(link).toHaveAttribute("href", destination);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  const opened = page.waitForEvent("popup");
  await link.focus();
  await link.press("Enter");
  const popup = await opened;
  await expect(popup).toHaveURL(destination);
  expect(
    await popup.evaluate(() => (globalThis as unknown as { opener: unknown }).opener === null),
  ).toBe(true);
  await popup.close();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`settings about owned links open as browser navigation at ${viewport.width}`, async ({
    harness,
    page,
    context,
    request,
  }, info) => {
    const browserEvents = linkBrowserEvents(page);
    await page.setViewportSize(viewport);
    await context.route("https://github.com/arcee-ai/nac**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Owned link double</title>",
      }),
    );
    await page.route(`${harness.baseUrl}/store`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), store_path: "/fixture/store.db" },
      });
    });
    await createProject(request, harness, { name: "External links fixture" });
    // Docs, GitHub and the store path moved from the old header menu to Settings › About.
    await page.goto(`${harness.baseUrl}/#/`);
    const home = page.url();
    if (viewport.width < 768) {
      await page.getByRole("button", { name: "Open the menu", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Menu", exact: true })
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      // On a phone the menu opens Settings on its section list (push navigation).
      await expect(page).toHaveURL(`${harness.baseUrl}/#/settings`);
    } else {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    }
    await page
      .getByRole("navigation", { name: "Settings sections", exact: true })
      .getByRole("link", { name: /^About/ })
      .click();
    const about = page.getByRole("main", { name: "About", exact: true });
    await expect(about).toBeVisible();
    await expect(page).toHaveURL(`${harness.baseUrl}/#/settings/about`);
    await expect(about.getByText("/fixture/store.db", { exact: true })).toBeVisible();
    const docs = about.getByRole("link", { name: /^Documentation/ });
    const repository = about.getByRole("link", { name: /^GitHub/ });
    await expect(docs).toBeVisible();
    await expect(repository).toBeVisible();
    await capture(
      page,
      info,
      `settings-about-${viewport.width}.png`,
      docs.locator(".."),
      browserEvents,
    );
    await followWithKeyboard(page, docs, "https://github.com/arcee-ai/nac#readme");
    await expect(about).toBeVisible();
    await followWithKeyboard(page, repository, "https://github.com/arcee-ai/nac");
    // Following an owned link never navigates the app itself.
    await expect(page).toHaveURL(`${harness.baseUrl}/#/settings/about`);
    if (viewport.width < 768)
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(home);
    await attachLinkBrowserEvents(info, browserEvents);
  });

  test(`provider browser auto-open and explicit retry share one attempt at ${viewport.width}`, async ({
    harness,
    page,
    context,
    request,
  }, info) => {
    const browserEvents = linkBrowserEvents(page);
    await page.setViewportSize(viewport);
    const destination = "https://auth-fixture.example.test/device";
    await context.route("https://auth-fixture.example.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Owned device double</title>",
      }),
    );
    let starts = 0;
    const canceled: string[] = [];
    const auth = (provider: "arcee" | "codex") => ({
      provider,
      signed_in: false,
      backend: provider === "arcee" ? "arcee-auth" : "chatgpt-codex-responses",
      base_url:
        provider === "arcee"
          ? "https://api.arcee.ai/api/v1"
          : "https://chatgpt.com/backend-api/codex",
      account: null,
      organization: null,
      expires_at_ms: null,
      path: `/fixture/${provider}.json`,
    });
    await page.route(`${harness.baseUrl}/auth`, (route) =>
      route.fulfill({ json: { providers: [auth("arcee"), auth("codex")] } }),
    );
    await page.route(`${harness.baseUrl}/auth/arcee/login`, (route) => {
      starts += 1;
      return route.fulfill({
        json: {
          provider: "arcee",
          login_id: "external-link-attempt",
          user_code: "ABCD-EFGH",
          verification_uri: destination,
          expires_in_secs: 600,
        },
      });
    });
    await page.route(`${harness.baseUrl}/auth/arcee/login/external-link-attempt`, (route) => {
      if (route.request().method() === "DELETE") {
        canceled.push("external-link-attempt");
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: { state: "pending" } });
    });
    const id = await linkSession(request, harness);
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    const accounts = await openSettingsSection(page, "Accounts & keys");
    // This is browser fallback, using controlled HTTP UI responses. Native
    // auth-owner and actual system-browser acceptance remain separate lanes.
    const automatic = page.waitForEvent("popup");
    await accounts.getByRole("button", { name: "Sign in with Arcee", exact: true }).click();
    const popup = await automatic;
    await expect(popup).toHaveURL(destination);
    expect(
      await popup.evaluate(() => (globalThis as unknown as { opener: unknown }).opener === null),
    ).toBe(true);
    await popup.close();
    await capture(page, info, `provider-retry-${viewport.width}.png`, accounts, browserEvents);
    await followWithKeyboard(
      page,
      accounts.getByRole("link", { name: "Open Arcee", exact: true }),
      destination,
    );
    expect(starts).toBe(1);
    await accounts.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => canceled).toEqual(["external-link-attempt"]);
    await expect(
      accounts.getByRole("button", { name: "Sign in with Arcee", exact: true }),
    ).toBeVisible();
    expect(starts).toBe(1);
    await expect(page).toHaveURL(`${harness.baseUrl}/#/settings/accounts`);
    await attachLinkBrowserEvents(info, browserEvents);
  });

  test(`session failure presents the wallet fix as a browser link at ${viewport.width}`, async ({
    harness,
    page,
    context,
    request,
  }, info) => {
    const browserEvents = linkBrowserEvents(page);
    await page.setViewportSize(viewport);
    const destination = "https://platform.arcee.ai/api/wallet";
    await context.route(destination, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Owned wallet double</title>",
      }),
    );
    const id = await linkSession(request, harness);
    await page.route(
      (url) => url.origin === new URL(harness.baseUrl).origin && url.pathname === `/sessions/${id}`,
      (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ status: 402, json: { error: "insufficient_credits" } })
          : route.fallback(),
    );
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    const wallet = page.getByRole("link", { name: "Open wallet", exact: true });
    await expect(wallet).toBeVisible();
    await capture(
      page,
      info,
      `error-wallet-${viewport.width}.png`,
      wallet.locator(".."),
      browserEvents,
    );
    await followWithKeyboard(page, wallet, destination);
    await expect(page).toHaveURL(new RegExp(`/#/session/${id}/insights$`));
    await attachLinkBrowserEvents(info, browserEvents);
  });
}
