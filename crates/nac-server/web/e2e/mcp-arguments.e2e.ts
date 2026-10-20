import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

import { createProject, createSession, expect, test } from "./harness";
import { startHostedFixture } from "./hosted-fixture";
import { STDIO_MCP_SERVER, openCustomMcpServer } from "./mcp-library-fixture";

// Browser globals used inside evaluate(); the e2e project has no DOM lib.
type DomElement = {
  tagName: string;
  className: string;
  scrollWidth: number;
  clientWidth: number;
  textContent: string | null;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
};
type FieldElement = DomElement & {
  value: string;
  scrollLeft: number;
  selectionStart: number | null;
  setSelectionRange(start: number, end: number): void;
};
declare const document: { activeElement: DomElement };
declare const navigator: { clipboard: { writeText(text: string): Promise<void> } };
declare function getComputedStyle(element: DomElement): {
  outlineStyle: string;
  overflowX: string;
  overflowY: string;
};

test.skip(
  !!process.env.NAC_E2E_REMOTE,
  "Requires disposable local workspaces and scripted providers",
);
test.use({ orchestration: "0" });

const ALLOWLIST = "linear_add_comment,linear_read_issue,linear_update_issue";
const SPACED = `--label="${"a long spaced value ".repeat(8).trim()}"`;
type Sent = { method: string; path: string; body: Record<string, unknown> };

/** Records the browser's MCP library writes, with the JSON body each one sent. */
function recordWrites(page: Page) {
  const sent: Sent[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const at = url.pathname.indexOf("/mcp_library/servers");
    if (at < 0 || request.method() === "GET") return;
    sent.push({
      method: request.method(),
      path: url.pathname.slice(at),
      body: request.postDataJSON() ?? {},
    });
  });
  return sent;
}

async function reopen(page: Page, mobile: boolean, name: string) {
  if (mobile) await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  // The phone editor slides in; measure it only once its position has stopped changing.
  const left = async () => (await dialog.boundingBox())?.x;
  await expect
    .poll(async () => {
      const before = await left();
      await page.waitForTimeout(100);
      return before === (await left());
    })
    .toBe(true);
  return dialog;
}

/** The header helper's forwarded-environment list, found by its label. */
function forwardedEnvironment(dialog: Locator) {
  return dialog
    .getByText("Header helper forwarded environment", { exact: true })
    .locator("xpath=ancestor::div[.//textarea][1]//textarea");
}

/** Real clipboard paste over the given selection of `field`. */
async function paste(page: Page, field: Locator, text: string, selection?: [number, number]) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await field.focus();
  if (selection)
    await field.evaluate(
      (input: FieldElement, [start, end]) => input.setSelectionRange(start, end),
      selection,
    );
  else await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+V");
}

/** The focused element, by accessible label, with its focus ring drawn. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      name: element.getAttribute("aria-label") ?? element.textContent?.trim(),
      ring: element.matches(":focus-visible") && style.outlineStyle !== "none",
    };
  });
}

async function expectTabOrder(page: Page, names: string[]) {
  for (const name of names) {
    await page.keyboard.press("Tab");
    expect(await focused(page)).toEqual({ name, ring: true });
  }
}

/** Checks every scroll container in the dialog, which can clip overflow the page never sees. */
async function expectNoSidewaysOverflow(dialog: Locator, controls: Locator) {
  const overflowing = await dialog.evaluate((root: DomElement) =>
    [root, ...Array.from(root.querySelectorAll("*"))]
      .filter((element) => {
        // Fields scroll their own long values; that is required, not overflow.
        if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return false;
        const style = getComputedStyle(element);
        const scrolls = /auto|scroll|hidden/.test(style.overflowX + style.overflowY);
        return (element === root || scrolls) && element.scrollWidth > element.clientWidth + 1;
      })
      .map((element) => element.className),
  );
  expect(overflowing).toEqual([]);
  const bounds = (await dialog.boundingBox())!;
  const all = await controls.all();
  expect(all.length).toBeGreaterThan(2);
  for (const control of all) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
}

/** The long value scrolls inside its own field, so its end stays editable. */
async function expectScrollsInside(page: Page, field: Locator) {
  await field.focus();
  await page.keyboard.press("End");
  expect(
    await field.evaluate(
      (input: FieldElement) =>
        input.scrollWidth > input.clientWidth &&
        input.scrollLeft > 0 &&
        input.selectionStart === input.value.length,
    ),
  ).toBe(true);
}

/** A loopback streamable-HTTP MCP double that records the headers it receives. */
async function startHttpServer() {
  const headers: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      headers.push(request.headers);
      const message = JSON.parse(raw);
      if (message.id === undefined) {
        response.writeHead(202);
        response.end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "helper-fixture", version: "1" },
            }
          : message.method === "tools/list"
            ? { tools: [{ name: "helper_echo", inputSchema: { type: "object", properties: {} } }] }
            : {};
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    headers,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

for (const mobile of [false, true]) {
  const viewport = mobile ? "mobile" : "desktop";

  test(`stdio arguments by keyboard and clipboard ${viewport}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const script = path.join(harness.runRoot, "argument-mcp.cjs");
    await fs.writeFile(script, STDIO_MCP_SERVER);
    const project = await createProject(request, harness, { name: "MCP argument rows" });
    const fixture = await startHostedFixture(
      harness,
      await createSession(request, harness, "direct", project),
    );
    try {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], { origin: fixture.baseUrl });
      await page.goto(fixture.baseUrl);
      const sent = recordWrites(page);
      const form = await openCustomMcpServer(page, mobile);
      await form.getByPlaceholder("my_server").fill("argument_rows");
      await form.getByRole("button", { name: "Stdio", exact: true }).click();
      await form.getByRole("button", { name: "Legacy", exact: true }).click();
      const command = form.getByPlaceholder("npx");
      await command.fill(process.execPath);
      const field = (n: number) =>
        form.getByRole("textbox", { name: `Argument ${n}`, exact: true });
      const removes = form.getByRole("button", { name: /^Remove argument \d+$/ });
      const controls = form
        .getByRole("textbox", { name: /^Argument \d+$/ })
        .or(removes)
        .or(form.getByRole("button", { name: "Add argument", exact: true }));

      // Keyboard only from the command field: Add, then removing the only row returns to Add.
      await command.focus();
      await expectTabOrder(page, ["Add argument"]);
      await page.keyboard.press("Enter");
      expect(await focused(page)).toEqual({ name: "Argument 1", ring: true });
      await expectTabOrder(page, ["Remove argument 1"]);
      await page.keyboard.press("Space");
      expect(await focused(page)).toEqual({ name: "Add argument", ring: true });
      await expect(field(1)).toHaveCount(0);
      for (const [at, value] of [
        script,
        "--middle",
        "--placeholder",
        "--keep-me",
        "--quiet-mode",
      ].entries()) {
        // Both activation keys add a row and focus it.
        await page.keyboard.press(at === 1 ? "Space" : "Enter");
        expect(await focused(page)).toEqual({ name: `Argument ${at + 1}`, ring: true });
        await page.keyboard.insertText(value);
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
      }
      await field(1).focus();
      await expectTabOrder(page, [
        "Remove argument 1",
        "Argument 2",
        "Remove argument 2",
        "Argument 3",
        "Remove argument 3",
        "Argument 4",
        "Remove argument 4",
        "Argument 5",
        "Remove argument 5",
        "Add argument",
      ]);
      // Removing the middle row focuses the row that took its place.
      await field(2).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      expect(await focused(page)).toEqual({ name: "Argument 2", ring: true });
      await expect(field(2)).toHaveValue("--placeholder");
      // Removing the last row focuses the one before it.
      await form.getByRole("button", { name: "Add argument", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.keyboard.insertText("--drop-last");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Space");
      expect(await focused(page)).toEqual({ name: "Argument 4", ring: true });
      await expect(field(4)).toHaveValue("--quiet-mode");
      await expect(field(5)).toHaveCount(0);
      // Keyboard Add/Remove never saved or tested anything.
      expect(sent).toEqual([]);

      // Real clipboard: a single line lands whole in the one selected field.
      await paste(page, field(2), ALLOWLIST);
      await expect(field(2)).toHaveValue(ALLOWLIST);
      await expect(removes).toHaveCount(4);
      // Only blank lines over a fully selected value empty it, keeping the row and focus.
      await paste(page, field(3), "\n  \r\n\n");
      await expect(field(3)).toHaveValue("");
      await expect(field(3)).toBeFocused();
      // Lines over a partial selection keep its prefix and suffix, then later rows.
      await paste(page, field(4), "loud\r\n-y", [2, 7]);
      await expect(field(4)).toHaveValue("--loud");
      await expect(field(5)).toHaveValue("-y-mode");
      await expect(field(5)).toBeFocused();
      await form.getByRole("button", { name: "Add argument", exact: true }).click();
      await page.keyboard.insertText(SPACED);

      await expectNoSidewaysOverflow(form, controls);
      await expectScrollsInside(page, field(6));
      // Add and Remove still work beside the long value.
      await form.getByRole("button", { name: "Add argument", exact: true }).click();
      await expect(field(7)).toBeFocused();
      await form.getByRole("button", { name: "Remove argument 7", exact: true }).click();
      await expect(field(7)).toHaveCount(0);
      await expect(field(6)).toHaveValue(SPACED);
      await expect(field(6)).toBeFocused();

      const args = [script, ALLOWLIST, "--loud", "-y-mode", SPACED];
      await form.getByRole("button", { name: "Test connection", exact: true }).click();
      await expect(form.getByText("1 tool found", { exact: true })).toBeVisible();
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => sent.length).toBe(2);
      expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
        "POST /mcp_library/servers/test",
        "POST /mcp_library/servers",
      ]);
      expect(sent.map((call) => call.body.args)).toEqual([args, args]);

      const editing = await reopen(page, mobile, "argument_rows");
      for (const [at, value] of args.entries()) await expect(field(at + 1)).toHaveValue(value);
      await expect(editing.getByRole("textbox", { name: /^Argument \d+$/ })).toHaveCount(5);
      await expectNoSidewaysOverflow(editing, controls);
      const saved = (
        await (await request.get(`${harness.baseUrl}/mcp_library/servers`)).json()
      ).servers.find((server: { name: string }) => server.name === "argument_rows");
      expect(saved.args).toEqual(args);
    } finally {
      await fixture.stop();
    }
  });

  test(`header helper arguments run, save and reopen in order ${viewport}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const record = path.join(harness.runRoot, `helper-${viewport}.json`);
    const helper = path.join(harness.runRoot, "header-helper.cjs");
    // The helper records its argv and the forwarded variable, then prints one header.
    await fs.writeFile(
      helper,
      `require('node:fs').writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(2),forwarded:process.env.NAC_E2E_API_KEY??null}));
process.stdout.write(JSON.stringify({'X-Fixture-Token':'helper-ran'}));\n`,
    );
    const upstream = await startHttpServer();
    const project = await createProject(request, harness, { name: "MCP helper arguments" });
    const fixture = await startHostedFixture(
      harness,
      await createSession(request, harness, "direct", project),
    );
    try {
      await page.goto(fixture.baseUrl);
      const sent = recordWrites(page);
      const form = await openCustomMcpServer(page, mobile);
      await form.getByPlaceholder("my_server").fill("helper_rows");
      await form.getByRole("button", { name: "Legacy", exact: true }).click();
      await form.getByPlaceholder("https://example.com/mcp").fill(upstream.url);
      await form.getByPlaceholder("./refresh-mcp-headers").fill(process.execPath);
      const field = (n: number) =>
        form.getByRole("textbox", { name: `Header helper argument ${n}`, exact: true });
      const controls = form
        .getByRole("textbox", { name: /^Header helper argument \d+$/ })
        .or(form.getByRole("button", { name: /^Remove header helper argument \d+$/ }))
        .or(form.getByRole("button", { name: "Add argument", exact: true }));
      for (const value of [helper, "--drop-me", "--profile", "a b", ALLOWLIST]) {
        await form.getByRole("button", { name: "Add argument", exact: true }).click();
        await page.keyboard.insertText(value);
      }
      // Helper rows are named apart from stdio rows.
      await expect(form.getByRole("textbox", { name: /^Argument \d+$/ })).toHaveCount(0);
      await form.getByRole("button", { name: "Remove header helper argument 2" }).click();
      await expect(field(2)).toBeFocused();
      await field(3).fill("a b c");
      await form.getByRole("button", { name: "Add argument", exact: true }).click();
      await page.keyboard.insertText(SPACED);
      const forwarded = forwardedEnvironment(form);

      await expectNoSidewaysOverflow(form, controls);
      await expectScrollsInside(page, field(5));
      await form.getByRole("button", { name: "Remove header helper argument 5" }).click();
      await expect(field(5)).toHaveCount(0);
      await expect(field(4)).toBeFocused();
      await form.getByRole("button", { name: "Add argument", exact: true }).click();
      await expect(field(5)).toBeFocused();
      await page.keyboard.insertText(SPACED);

      const args = [helper, "--profile", "a b c", ALLOWLIST, SPACED];
      const testConnection = form.getByRole("button", { name: "Test connection", exact: true });
      // The helper inherits the server environment, so the value alone would not show the
      // forwarded list is read; forwarding a name the server lacks must fail the test first.
      await forwarded.fill("NAC_E2E_UNSET_FORWARD");
      await testConnection.click();
      await expect(page.getByText(/^Test failed:/)).toBeVisible();
      await expect(fs.stat(record)).rejects.toThrow();
      // NAC_E2E_API_KEY is set only by the e2e harness for nac-web.
      await forwarded.fill("NAC_E2E_API_KEY");
      await testConnection.click();
      await expect(form.getByText("1 tool found", { exact: true })).toBeVisible();
      const ran = JSON.parse(await fs.readFile(record, "utf8"));
      expect(ran).toEqual({ args: args.slice(1), forwarded: "nac-e2e-dummy-only" });
      expect(upstream.headers.some((h) => h["x-fixture-token"] === "helper-ran")).toBe(true);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => sent.length).toBe(3);
      expect(sent.map((call) => call.body.header_helper)).toMatchObject([
        { args, env_vars: ["NAC_E2E_UNSET_FORWARD"] },
        { args, env_vars: ["NAC_E2E_API_KEY"] },
        { args, env_vars: ["NAC_E2E_API_KEY"] },
      ]);

      const editing = await reopen(page, mobile, "helper_rows");
      for (const [at, value] of args.entries())
        await expect(
          editing.getByRole("textbox", { name: `Header helper argument ${at + 1}`, exact: true }),
        ).toHaveValue(value);
      await expect(forwardedEnvironment(editing)).toHaveValue("NAC_E2E_API_KEY");
      const saved = (
        await (await request.get(`${harness.baseUrl}/mcp_library/servers`)).json()
      ).servers.find((server: { name: string }) => server.name === "helper_rows");
      expect(saved.header_helper).toMatchObject({ args, env_vars: ["NAC_E2E_API_KEY"] });
    } finally {
      await fixture.stop();
      await upstream.stop();
    }
  });
}
