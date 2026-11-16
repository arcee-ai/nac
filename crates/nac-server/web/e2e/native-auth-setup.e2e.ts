import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProject, expect, test } from "./harness";

test.use({ orchestration: "0" });

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = await fs.readFile(path.join(repo, "desktop/macos/ExternalAuthSmoke.swift"), "utf8");
function script(name: string): string {
  const match = source.match(new RegExp(`static let ${name} = #"""([\\s\\S]*?)"""#`));
  if (!match) throw new Error(`Missing actual native fixture script: ${name}`);
  return match[1]!;
}
const ready = new Function("expectedRoute", script("sessionReadyScript")) as (
  route: string,
) => boolean;

test("native auth setup settles session navigation and refreshes the real MCP cache before OAuth", async ({
  page,
  request,
  harness,
}) => {
  // Catalog contents are unrelated to the owned disabled server and OAuth
  // controls. Keep this test's optional registry read entirely local.
  await page.route("**/mcp_library/library", (route) => route.fulfill({ json: { entries: [] } }));
  let serverReads = 0;
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/mcp_library/servers" && sent.method() === "GET")
      serverReads++;
  });
  const project = await createProject(request, harness, {
    name: "Native auth preparation",
  });
  const initialMcp = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/mcp_library/servers" &&
      response.request().method() === "GET",
  );
  await page.goto(`${harness.baseUrl}/#/project/${project}`);
  const empty = await initialMcp;
  expect(empty.ok()).toBe(true);
  expect((await empty.json()).servers).toEqual([]);
  await empty.finished();
  await expect(page.getByRole("button", { name: "Create chat", exact: true })).toBeVisible();
  await expect.poll(() => serverReads).toBeGreaterThan(0);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let accept!: (session: string) => void;
  const accepted = new Promise<string>((resolve) => {
    accept = resolve;
  });
  await page.route("**/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    const session = (await response.json()).metadata.session_id as string;
    accept(session);
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Create chat", exact: true }).click();
    const session = await accepted;
    expect(await page.evaluate(ready, "")).toBe(false);
    await page
      .getByRole("button", { name: /^MCP servers/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "MCP servers",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add server", exact: true })).toBeVisible();
    await expect(dialog.getByText("Loading…", { exact: true })).toHaveCount(0);
    release();
    await expect(page).toHaveURL(new RegExp(`#/session/${session}(?:/|$)`));
    // The actor must not advance through an open dialog. Whether this
    // presentation retains that dialog on navigation is not this contract.
    if (await dialog.isVisible()) {
      expect(await page.evaluate(ready, "")).toBe(false);
      await dialog
        .getByRole("button", { name: "Close", exact: true })
        .filter({ hasText: /^Close$/ })
        .click();
    }
    await expect.poll(() => page.evaluate(ready, "")).toBe(true);
    const sessionRoute = new URL(page.url()).hash;

    const credential = await request.post(`${harness.baseUrl}/credentials`, {
      data: { value: "local-fixture-client" },
    });
    expect(credential.ok()).toBe(true);
    const name = ((await credential.json()) as { name: string }).name;
    const created = await request.post(`${harness.baseUrl}/mcp_library/servers`, {
      data: {
        name: "external-auth-fixture",
        enabled: false,
        transport: "streamable_http",
        url: `${harness.provider.baseUrl}/mcp`,
        headers: {},
        args: [],
        env: {},
      },
    });
    expect(created.ok()).toBe(true);
    const configured = await request.post(
      `${harness.baseUrl}/mcp_library/servers/external-auth-fixture/oauth/configure`,
      {
        data: {
          registration: { type: "pre_registered", client_id_credential: name },
          scopes: ["fixture:read"],
          authorization_metadata: {
            authorization_endpoint: `${harness.provider.baseUrl}/oauth/authorize/success`,
            token_endpoint: `${harness.provider.baseUrl}/oauth/token`,
            issuer: harness.provider.baseUrl,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          },
        },
      },
    );
    expect(configured.ok()).toBe(true);
    const before = serverReads;
    await page
      .getByRole("button", { name: /^MCP servers/ })
      .first()
      .click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "external-auth-fixture",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(serverReads).toBe(before); // Raw fixture writes did not invalidate the warm query.
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .filter({ hasText: /^Close$/ })
      .click();
    await page.reload();
    await expect.poll(() => page.evaluate(ready, sessionRoute)).toBe(true);
    await page
      .getByRole("button", { name: /^MCP servers/ })
      .first()
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "external-auth-fixture",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Authenticate", exact: true })).toBeEnabled();
    expect(harness.provider.requests).toHaveLength(0);
  } finally {
    release();
  }
});
