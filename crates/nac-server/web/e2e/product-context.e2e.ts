import path from "node:path";
import fs from "node:fs/promises";
import type { Page } from "@playwright/test";
import { createSession, expect, test, waitForRunIdle } from "./harness";
import {
  leaveSettings,
  openCapabilities,
  openSettingsSection,
  settingsSection,
} from "./settings-focus";

/** Settings › Capabilities for the session on screen, by the palette (the product entry). */
async function inspect(page: Page) {
  return openCapabilities(page);
}
async function capture(page: Page, name: string) {
  if (!process.env.NAC_PRODUCT_CONTEXT_CAPTURES) return;
  await fs.mkdir(process.env.NAC_PRODUCT_CONTEXT_CAPTURES, { recursive: true });
  await page.evaluate("document.fonts.ready.then(() => true)");
  await page.screenshot({
    path: path.join(process.env.NAC_PRODUCT_CONTEXT_CAPTURES, `${name}.png`),
    animations: "disabled",
  });
}

for (const mobile of [false, true]) {
  test(`scoped product context and explicit destinations on ${mobile ? "phone" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    const id = await createSession(request, harness, "direct");
    const initialConfig = await (
      await request.get(`${harness.baseUrl}/sessions/${id}/config`)
    ).json();
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Model: .+, High reasoning$/ })).toBeVisible();
    const baseline = process.env.NAC_PRODUCT_CONTEXT_BASELINE === "1";
    await capture(page, `${mobile ? "phone" : "desktop"}-navigation`);
    if (baseline) {
      // Pre-Settings-page builds: the capabilities entry is absent from the old menu.
      if (mobile) await page.getByRole("button", { name: "Open the menu", exact: true }).click();
      await expect(page.getByRole("button", { name: "NAC capabilities", exact: true })).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: /^MCP servers/ }).click();
      await expect(page.getByRole("dialog", { name: "MCP servers", exact: true })).toBeVisible();
      await capture(page, `${mobile ? "phone" : "desktop"}-mcp`);
      return;
    }
    const mutations: string[] = [];
    page.on("request", (event) => {
      const route = new URL(event.url()).pathname;
      // These POST endpoints are read-only queries. Existing configuration
      // pages inspect provider models without saving credentials/configuration.
      const passivePost =
        event.method() === "POST" &&
        ["/product-destinations/resolve", "/providers/models"].includes(route);
      if (event.method() !== "GET" && !passivePost) mutations.push(`${event.method()} ${route}`);
    });
    const original = page.url();
    const capabilitiesUrl = `${harness.baseUrl}/#/settings/capabilities?session=${id}`;
    // Capabilities is a Settings section scoped to the session it was opened from.
    let context = await inspect(page);
    await expect(page).toHaveURL(capabilitiesUrl);
    await expect(context.getByText("direct", { exact: true })).toBeVisible();
    await expect(context.getByText("local", { exact: true })).toBeVisible();
    await expect(
      context.getByRole("button", { name: "Open Configurations", exact: true }),
    ).toHaveCount(0);
    await expect(settingsSection(page, "MCP servers")).toHaveCount(0);
    await capture(page, `${mobile ? "phone" : "desktop"}-capabilities`);
    // Keyboard activation goes through the bounded navigation bridge, with no Markdown action bridge.
    const mcp = context.getByRole("button", { name: "Open MCP settings", exact: true });
    await mcp.focus();
    await page.keyboard.press("Enter");
    const mcpSection = settingsSection(page, "MCP servers");
    await expect(mcpSection).toBeVisible();
    await expect(page).toHaveURL(`${harness.baseUrl}/#/settings/mcp`);
    await capture(page, `${mobile ? "phone" : "desktop"}-mcp`);
    // Leaving Settings returns to the session the user came from.
    await leaveSettings(page);
    await expect(mcpSection).toHaveCount(0);
    await expect(page).toHaveURL(original);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    for (const [label, title] of [
      ["Model authentication", "Accounts & keys"],
      ["SSH configurations", "SSH hosts"],
    ]) {
      context = await inspect(page);
      await context.getByRole("button", { name: `Open ${label}`, exact: true }).click();
      const section = settingsSection(page, title);
      await expect(section).toBeVisible();
      await leaveSettings(page);
      await expect(section).toHaveCount(0);
      await expect(page).toHaveURL(original);
    }
    for (const [label, panel] of [
      ["Subagents", "delegated"],
      ["Files", "files"],
      ["Terminal", "terminal"],
    ]) {
      context = await inspect(page);
      await context.getByRole("button", { name: `Open ${label}`, exact: true }).click();
      await expect(context).toBeHidden();
      // The panel opens inside the session the capabilities described.
      await expect(page).toHaveURL(new RegExp(`/session/${id}/${panel}$`));
      const surface = mobile
        ? page.getByRole("dialog", { name: label, exact: true })
        : page.getByRole("complementary", { name: label, exact: true });
      await expect(surface).toBeVisible();
      if (mobile) await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: "Session panel", exact: true }).click();
      await expect(surface).toBeHidden();
    }
    context = await inspect(page);
    await context.getByRole("button", { name: "Open History", exact: true }).click();
    if (mobile) {
      await expect(context).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/session/${id}/history$`));
      const history = page.getByRole("dialog", { name: "History", exact: true });
      await expect(history).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(history).toBeHidden();
    } else {
      await expect(context).toBeVisible();
      await expect(context.getByText(/use the revision selector on desktop/)).toBeVisible();
      await expect(page).toHaveURL(capabilitiesUrl);
    }
    context = await inspect(page);
    await context.getByRole("button", { name: "Open Projects", exact: true }).click();
    await expect(page).toHaveURL(`${harness.baseUrl}/#/`);
    expect(mutations).toEqual([]);
    expect(await (await request.get(`${harness.baseUrl}/sessions/${id}/config`)).json()).toEqual(
      initialConfig,
    );
    const facts = await request.get(`${harness.baseUrl}/product-context?session_id=${id}`);
    expect(facts.ok()).toBe(true);
    expect((await facts.json()).session.execution_backend).toBe("local");
    const sessions = await request.get(`${harness.baseUrl}/sessions`);
    expect(
      (await sessions.json()).map(
        (entry: { summary: { session_id: string; run_count: number } }) => [
          entry.summary.session_id,
          entry.summary.run_count,
        ],
      ),
    ).toEqual([[id, 0]]);
    expect(harness.provider.requests).toHaveLength(0);
  });
}

test("native context tools resolve an explicit headless destination without executing Markdown", async ({
  harness,
  request,
  page,
}) => {
  test.skip(
    process.env.NAC_PRODUCT_CONTEXT_BASELINE === "1",
    "Native context tools are new in this candidate",
  );
  const id = await createSession(request, harness, "direct");
  const facts = await (
    await request.get(`${harness.baseUrl}/product-context?session_id=${id}`)
  ).json();
  harness.provider.enqueue(
    "context-read",
    {
      token: "PRODUCT_CONTEXT_NATIVE",
      requiredTools: ["get_product_context", "resolve_product_destination"],
    },
    { kind: "function_call", name: "get_product_context", callId: "context-read", arguments: {} },
  );
  harness.provider.enqueue(
    "destination-resolve",
    { functionOutputCallId: "context-read" },
    {
      kind: "function_call",
      name: "resolve_product_destination",
      callId: "destination-resolve",
      arguments: { destination: "mcp-settings", expected_build_id: facts.build.build_id },
    },
  );
  harness.provider.enqueue(
    "context-answer",
    { functionOutputCallId: "destination-resolve" },
    { kind: "text", text: "Open MCP in the sidebar. [Untrusted action](nac://settings/mcp)" },
  );
  const response = await request.post(`${harness.baseUrl}/sessions/${id}/runs`, {
    data: { prompt: "PRODUCT_CONTEXT_NATIVE inspect capabilities and resolve MCP settings" },
  });
  expect(response.status()).toBe(202);
  await waitForRunIdle(request, harness, id);
  harness.provider.assertConsumed();
  await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
  await expect(page.getByText("Open MCP in the sidebar.", { exact: false }).first()).toBeVisible();
  // A headless resolution never navigates the browser to Settings.
  await expect(page).toHaveURL(`${harness.baseUrl}/#/session/${id}/insights`);
  await expect(settingsSection(page, "MCP servers")).toHaveCount(0);
  await expect(page.locator('a[href^="nac:"]')).toHaveCount(0);
  const outputs = JSON.stringify(harness.provider.requests.at(-1)?.body);
  expect(outputs).toContain("opened");
  expect(outputs).toContain("false");
});

test("replacing an injected runtime discards a pending navigation for the same session", async ({
  harness,
  request,
  page,
}) => {
  test.skip(process.env.NAC_PRODUCT_CONTEXT_BASELINE === "1", "Navigation lifetime bridge is new");
  const { startHostedFixture } = await import("./hosted-fixture");
  const id = await createSession(request, harness, "direct");
  const fixture = await startHostedFixture(harness, id);
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  let arrived!: () => void;
  const accepted = new Promise<void>((done) => {
    arrived = done;
  });
  try {
    await page.route("**/product-destinations/resolve", async (route) => {
      const response = await route.fetch();
      arrived();
      await pending;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.goto(fixture.baseUrl);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    const context = await inspect(page);
    await context.getByRole("button", { name: "Open MCP settings", exact: true }).click();
    await accepted;
    await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
    release();
    // The replacement presentation starts on its own session route; the retired
    // runtime's pending receipt cannot navigate it to Settings.
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    await expect(settingsSection(page, "MCP servers")).toHaveCount(0);
    await expect(settingsSection(page, "Capabilities")).toHaveCount(0);
    await inspect(page);
    await expect(settingsSection(page, "MCP servers")).toHaveCount(0);
    expect(
      fixture.calls.filter((call) => call.path === "/product-destinations/resolve"),
    ).toHaveLength(1);
    expect(harness.provider.requests).toHaveLength(0);
  } finally {
    release();
    await fixture.stop();
  }
});

test("an old standalone document cannot read or navigate a replacement server at the same origin/build", async ({
  harness,
  request,
  page,
}) => {
  test.skip(
    process.env.NAC_PRODUCT_CONTEXT_BASELINE === "1",
    "Product serving-incarnation fence is new",
  );
  const id = await createSession(request, harness, "direct");
  await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
  await expect(page.getByRole("button", { name: /^Model: .+, High reasoning$/ })).toBeVisible();
  let context = await inspect(page);
  await context.getByRole("button", { name: "Open MCP settings", exact: true }).click();
  await expect(settingsSection(page, "MCP servers")).toBeVisible();
  await leaveSettings(page);
  await expect(page.getByRole("button", { name: /^Model: .+, High reasoning$/ })).toBeVisible();
  const origin = harness.baseUrl;
  await harness.restart(undefined, true);
  expect(harness.baseUrl).toBe(origin);
  context = await openSettingsSection(page, "Capabilities");
  await expect(context.getByRole("alert")).toHaveText(
    "Product context is unavailable. Reload this app to reconnect to its current serving instance.",
  );
  await expect(context.getByRole("button", { name: "Open MCP settings", exact: true })).toHaveCount(
    0,
  );
  await expect(settingsSection(page, "MCP servers")).toHaveCount(0);
  await leaveSettings(page);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Model: .+, High reasoning$/ })).toBeVisible();
  context = await inspect(page);
  await context.getByRole("button", { name: "Open MCP settings", exact: true }).click();
  await expect(settingsSection(page, "MCP servers")).toBeVisible();
  expect(harness.provider.requests).toHaveLength(0);
});

test("a delayed old navigation receipt cannot open UI after a same-origin serving replacement", async ({
  harness,
  request,
  page,
}) => {
  test.skip(process.env.NAC_PRODUCT_CONTEXT_BASELINE === "1", "Pending receipt fence is new");
  const id = await createSession(request, harness, "direct");
  const origin = harness.baseUrl;
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  let arrived!: () => void;
  const accepted = new Promise<void>((done) => {
    arrived = done;
  });
  await page.route("**/product-destinations/resolve", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    arrived();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`${origin}/#/session/${id}/insights`);
    await expect(page.getByRole("button", { name: /^Model: .+, High reasoning$/ })).toBeVisible();
    const context = await inspect(page);
    await context.getByRole("button", { name: "Open MCP settings", exact: true }).click();
    await accepted;
    await harness.restart(undefined, true);
    expect(harness.baseUrl).toBe(origin);
    release();
    await expect(context.getByRole("alert")).toHaveText(
      "Product context is unavailable. Reload this app to reconnect to its current serving instance.",
    );
    await expect(
      context.getByRole("button", { name: "Open MCP settings", exact: true }),
    ).toHaveCount(0);
    await expect(settingsSection(page, "MCP servers")).toHaveCount(0);
    await expect(page).toHaveURL(`${origin}/#/settings/capabilities?session=${id}`);
    await capture(page, "desktop-serving-replaced");
    expect(harness.provider.requests).toHaveLength(0);
  } finally {
    release();
  }
});
