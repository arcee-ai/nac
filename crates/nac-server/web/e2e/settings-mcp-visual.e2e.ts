import type { Locator, Page, TestInfo } from "@playwright/test";
import { createSession, expect, test } from "./harness";
import { openCustomMcpServer } from "./mcp-library-fixture";
import { captureSetup, serveSetupBaseline, setupBaseline } from "./setup-visual-fixture";
import { openNameZoom } from "./session-name-zoom";

test.use({ orchestration: "0", hasTouch: true });
test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Requires an isolated local store and controlled MCP/OAuth fixtures",
);

async function noOverflow(dialog: Locator, info: TestInfo) {
  const evidence = await dialog.evaluate((root) => {
    type Node = {
      tagName: string;
      textContent: string | null;
      scrollWidth: number;
      clientWidth: number;
      parentElement: Node | null;
      getAttribute(name: string): string | null;
      getBoundingClientRect(): { x: number; y: number; width: number; height: number };
    };
    const { getComputedStyle, innerWidth, devicePixelRatio } = globalThis as unknown as {
      getComputedStyle(element: unknown): {
        overflowX: string;
        display: string;
        whiteSpace: string;
        width: string;
        minWidth: string;
        maxWidth: string;
      };
      innerWidth: number;
      devicePixelRatio: number;
    };
    const element = root as unknown as { querySelectorAll(selector: string): ArrayLike<Node> };
    return {
      innerWidth,
      devicePixelRatio,
      offenders: Array.from(element.querySelectorAll("*"))
        .filter(
          (node) =>
            node.tagName !== "INPUT" &&
            node.tagName !== "TEXTAREA" &&
            /auto|scroll|hidden/.test(getComputedStyle(node).overflowX) &&
            node.scrollWidth > node.clientWidth + 1,
        )
        .map((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            tagName: node.tagName,
            className: node.getAttribute("class"),
            text: node.textContent?.slice(0, 400),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            style: {
              overflowX: style.overflowX,
              display: style.display,
              whiteSpace: style.whiteSpace,
              width: style.width,
              minWidth: style.minWidth,
              maxWidth: style.maxWidth,
            },
            parentClass: node.parentElement?.getAttribute("class"),
            parentClientWidth: node.parentElement?.clientWidth,
          };
        }),
    };
  });
  await info.attach("overflow-node-evidence.json", {
    body: JSON.stringify({ dialog: await dialog.getAttribute("aria-label"), ...evidence }),
    contentType: "application/json",
  });
  const problems = evidence.offenders.map((node) => node.tagName);
  expect(problems).toEqual([]);
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Session settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Session settings", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Session title" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  return dialog;
}

for (const width of [1440, 768, 390]) {
  test(`settings and MCP edit, error, cancel and saved states at ${width}px`, async ({
    harness,
    page,
    request,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await serveSetupBaseline(page, harness.baseUrl);
    const id = await createSession(request, harness, "direct");
    const configUrl = `${harness.baseUrl}/sessions/${id}/config`;
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    const settings = await openSettings(page);
    await captureSetup(page, info, width, "settings-default");
    await settings
      .getByRole("textbox", { name: "Session title" })
      .fill("Runtime preferences fixture");
    await settings.getByText("Advanced execution settings", { exact: true }).click();
    await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
    const context = settings.getByRole("textbox", { name: "Context limit" });
    await context.fill("48000");
    await noOverflow(settings, info);
    await info.attach("settings-semantics.txt", {
      body: await settings.ariaSnapshot(),
      contentType: "text/plain",
    });
    await captureSetup(page, info, width, "settings-advanced", context);
    await settings.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await openSettings(page);
    await expect(settings.getByRole("textbox", { name: "Session title" })).toHaveValue("");
    await settings
      .getByRole("textbox", { name: "Session title" })
      .fill("Runtime preferences fixture");
    let attempts = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(configUrl, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      attempts += 1;
      if (attempts === 1)
        return route.fulfill({
          status: 400,
          json: { error: "Configured Deny: this runtime setting cannot be changed." },
        });
      await pending;
      return route.continue();
    });
    await settings.getByText("Advanced execution settings", { exact: true }).click();
    await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
    await context.fill("48000");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.getByRole("alert")).toContainText("Configured Deny");
    await captureSetup(page, info, width, "settings-rejected", settings.getByRole("alert"));
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await captureSetup(page, info, width, "settings-pending");
    release();
    await expect(settings).toHaveCount(0);
    await openSettings(page);
    await expect(settings.getByRole("textbox", { name: "Session title" })).toHaveValue(
      "Runtime preferences fixture",
    );
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);

    await openCustomMcpServer(page, width < 768);
    const form = page.getByRole("dialog", {
      name: width < 768 ? "Custom server" : "MCP servers",
      exact: true,
      includeHidden: true,
    });
    await form.getByPlaceholder("my_server").fill("research_tools");
    await form.getByRole("button", { name: "Stdio", exact: true }).click();
    await form.getByPlaceholder("npx").fill("npx");
    for (const value of [
      "--yes",
      "@fixture/mcp-server",
      "--description=" + "long-value-".repeat(12),
    ]) {
      await form.getByRole("button", { name: "Add argument", exact: true }).tap();
      await page.keyboard.insertText(value);
    }
    const environment = form.getByText("Environment", { exact: true }).locator("../..");
    await environment.getByRole("button", { name: "Add entry", exact: true }).click();
    if (setupBaseline()) {
      await environment.getByPlaceholder("API_KEY").fill("FIXTURE_TOKEN");
      await environment.getByPlaceholder("value").fill("${NAC_FIXTURE_TOKEN}");
    } else {
      await expect(form.getByLabel("Environment key 1")).toBeFocused();
      await form.getByLabel("Environment key 1").fill("FIXTURE_TOKEN");
      await form.getByLabel("Environment value 1").fill("${NAC_FIXTURE_TOKEN}");
      await expect(form.getByLabel("Environment value 1")).toHaveAttribute("type", "password");
    }
    await noOverflow(form, info);
    await form
      .getByPlaceholder("my_server")
      .dispatchEvent("keydown", { key: "Escape", isComposing: true, keyCode: 229 });
    await expect(form).toBeVisible();
    await info.attach("mcp-form-semantics.txt", {
      body: await form.ariaSnapshot(),
      contentType: "text/plain",
    });
    await captureSetup(page, info, width, "mcp-rows", environment);
    await page.route(`${harness.baseUrl}/mcp_library/servers/test`, (route) =>
      route.fulfill({
        json: {
          connected: true,
          tools: [{ name: "fixture_echo", description: "Controlled inert MCP fixture" }],
          error: null,
        },
      }),
    );
    await form.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(form.getByText("1 tool found", { exact: true })).toBeVisible();
    await captureSetup(
      page,
      info,
      width,
      "mcp-tested",
      form.getByText("1 tool found", { exact: true }),
    );
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("MCP server saved.", { exact: true })).toBeVisible();
    if (width < 768)
      await page.getByRole("button", { name: "research_tools", exact: true }).click();
    const savedForm = page.getByRole("dialog", {
      name: width < 768 ? "research_tools" : "MCP servers",
      exact: true,
      includeHidden: true,
    });
    await expect(savedForm.getByRole("textbox", { name: "Argument 1", exact: true })).toHaveValue(
      "--yes",
    );
    await savedForm.getByRole("button", { name: "Remove argument 2", exact: true }).click();
    await expect(savedForm.getByRole("textbox", { name: "Argument 2", exact: true })).toBeFocused();
    await savedForm.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("MCP server updated.", { exact: true })).toBeVisible();
    const saved = (await (await request.get(`${harness.baseUrl}/mcp_library/servers`)).json())
      .servers[0];
    expect(saved.args).toEqual(["--yes", "--description=" + "long-value-".repeat(12)]);
    if (width < 768)
      await page.getByRole("button", { name: "research_tools", exact: true }).click();
    await savedForm.getByRole("button", { name: "Delete server", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`${harness.baseUrl}/mcp_library/servers`)).json()).servers
            .length,
      )
      .toBe(0);
    await info.attach("screen-reader-semantics.txt", {
      body: await page.locator("body").ariaSnapshot(),
      contentType: "text/plain",
    });
  });
}

test("settings and MCP controls at actual 200 percent browser zoom", async ({
  harness,
  request,
}, info) => {
  test.setTimeout(90_000);
  const { context, page, zoom } = await openNameZoom(info, harness.baseUrl, (page) =>
    serveSetupBaseline(page, harness.baseUrl),
  );
  try {
    const id = await createSession(request, harness, "direct");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
      const settings = await openSettings(page);
      await noOverflow(settings, info);
      await captureSetup(page, info, width, "settings-200pct");
      await settings.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(settings).toHaveCount(0);
      const mobile = await page
        .getByRole("button", { name: "Open the menu", exact: true })
        .isVisible();
      await openCustomMcpServer(page, mobile);
      const form = page.getByRole("dialog", {
        name: mobile ? "Custom server" : "MCP servers",
        exact: true,
        includeHidden: true,
      });
      await form.getByPlaceholder("my_server").fill("zoom_fixture");
      await noOverflow(form, info);
      await captureSetup(page, info, width, "mcp-200pct");
      if (width === 390 && !setupBaseline()) {
        const controls = [];
        for (const name of ["Streamable HTTP", "Stdio", "Test connection"]) {
          const control = form.getByRole("button", { name, exact: true });
          await control.scrollIntoViewIfNeeded();
          const bounds = await control.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const { innerWidth } = globalThis as unknown as { innerWidth: number };
            return {
              text: element.textContent?.trim(),
              x: rect.x,
              width: rect.width,
              height: rect.height,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              viewportWidth: innerWidth,
            };
          });
          expect(bounds.text).toBe(name);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(bounds.viewportWidth);
          expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
          controls.push({ name, ...bounds });
          if (name !== "Stdio")
            await captureSetup(page, info, width, `mcp-200pct-${name}`, control);
        }
        await info.attach("mcp-200pct-control-bounds.json", {
          body: JSON.stringify(controls),
          contentType: "application/json",
        });
      }
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(form).toHaveCount(0);
      if (mobile) {
        // Cancelling the phone draft returns to the picker above the server list.
        const picker = page.getByRole("dialog", {
          name: "Add server",
          exact: true,
          includeHidden: true,
        });
        await picker.getByRole("button", { name: "Close", exact: true }).click();
        await expect(picker).toHaveCount(0);
        const servers = page.getByRole("dialog", {
          name: "MCP servers",
          exact: true,
          includeHidden: true,
        });
        await servers.getByRole("button", { name: "Close", exact: true }).click();
        await expect(servers).toHaveCount(0);
      }
      await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
    }
    await info.attach("browser-zoom.json", {
      body: JSON.stringify({
        zoom,
        method: "chrome.tabs.setZoom/getZoom",
        physicalDevice: false,
        screenReader: "ARIA snapshot only; no OS assistive technology",
      }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});

test("library selection and OAuth complete/cancel stay in the owning phone form", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await serveSetupBaseline(page, harness.baseUrl);
  const id = await createSession(request, harness, "direct");
  const entry = {
    id: "fixture-oauth",
    name: "Research library fixture",
    description:
      "A controlled external fixture for authorization, with a long description that wraps without hiding actions.",
    category: "Research",
    tags: ["fixture"],
    auth: "none",
    transport: "streamable_http",
    url: "https://mcp.example.test/mcp",
    docs_url: "https://example.test/docs",
    icon_url: null,
  };
  await page.route(`${harness.baseUrl}/mcp_library/library`, (route) =>
    route.fulfill({ json: { entries: [entry] } }),
  );
  let status = "needs_configuration";
  const operations: string[] = [];
  await page.route(
    `${harness.baseUrl}/mcp_library/servers/Research%20library%20fixture/oauth/**`,
    async (route) => {
      const operation = new URL(route.request().url()).pathname.split("/").at(-1)!;
      operations.push(operation);
      if (operation === "configure" || operation === "logout") status = "needs_authorization";
      if (operation === "authenticate") status = "connecting";
      return route.fulfill({
        json: {
          status,
          authorization_url: status === "connecting" ? "https://auth.example.test/authorize" : null,
        },
      });
    },
  );
  await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
  await page.getByRole("button", { name: "Open the menu", exact: true }).click();
  await page.getByRole("button", { name: /^MCP servers/ }).click();
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await page.getByPlaceholder("Search the library").fill("Research library");
  await page.getByRole("button").filter({ hasText: entry.name }).click();
  const form = page.getByRole("dialog", {
    name: entry.name,
    exact: true,
    includeHidden: true,
  });
  await expect(form.getByPlaceholder("my_server")).toHaveValue(entry.name);
  await noOverflow(form, info);
  await captureSetup(page, info, 390, "mcp-library");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("MCP server saved.", { exact: true })).toBeVisible();
  await expect(form).toHaveCount(0);
  const servers = page.getByRole("dialog", { name: "MCP servers", exact: true });
  const savedServer = servers.getByRole("button", { name: entry.name, exact: true });
  await savedServer.click();
  const editor = page.getByRole("dialog", {
    name: entry.name,
    exact: true,
    includeHidden: true,
  });
  await expect(editor.getByText("Not configured", { exact: true })).toBeVisible();
  await editor.getByPlaceholder("SLACK_MCP_CLIENT_ID").fill("FIXTURE_CLIENT_ID_REFERENCE");
  await editor.getByRole("button", { name: "Configure OAuth", exact: true }).click();
  await editor.getByRole("button", { name: "Authenticate", exact: true }).click();
  await expect(editor.getByText("Waiting for authorization", { exact: true })).toBeVisible();
  await captureSetup(
    page,
    info,
    390,
    "mcp-oauth-pending",
    editor.getByRole("button", { name: "Cancel authorization" }),
  );
  await editor.getByRole("button", { name: "Cancel authorization", exact: true }).click();
  await expect(editor.getByText("Ready to connect", { exact: true })).toBeVisible();
  const authenticateUrl = `${harness.baseUrl}/mcp_library/servers/${encodeURIComponent(entry.name)}/oauth/authenticate`;
  await Promise.all([
    page.waitForResponse(
      (response) => response.url() === authenticateUrl && response.request().method() === "POST",
    ),
    editor.getByRole("button", { name: "Authenticate", exact: true }).click(),
  ]);
  status = "connected";
  await expect(editor.getByText("Connected", { exact: true })).toBeVisible();
  await captureSetup(
    page,
    info,
    390,
    "mcp-oauth-connected",
    editor.getByRole("button", { name: "Log out", exact: true }),
  );
  expect(operations.filter((operation) => operation === "authenticate")).toHaveLength(2);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(servers).toBeVisible();
  await expect(savedServer).toBeFocused();
});
