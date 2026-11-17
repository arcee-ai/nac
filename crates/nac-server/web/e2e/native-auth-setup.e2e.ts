import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProject, expect, test, waitForRunIdle } from "./harness";
import { leaveSettings, openCommandPalette, openSettingsSection } from "./settings-focus";

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
  // Home starts a session for the project: create, deliver the first message, then open it.
  await page.goto(`${harness.baseUrl}/#/?project=${project}`);
  const empty = await initialMcp;
  expect(empty.ok()).toBe(true);
  expect((await empty.json()).servers).toEqual([]);
  await empty.finished();
  const composer = page.getByRole("textbox", { name: "What should we work on?", exact: true });
  await expect(composer).toBeVisible();
  await expect.poll(() => serverReads).toBeGreaterThan(0);
  const prompt = "NATIVE_AUTH_SETUP first message";
  harness.provider.enqueue(
    "first-message",
    { token: prompt },
    { kind: "text", text: "native auth setup ready", stream: "request" },
  );
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
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  try {
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    const session = await accepted;
    expect(await page.evaluate(ready, "")).toBe(false);
    // A dialog opened while the create is pending (here the palette over Home).
    await openCommandPalette(page);
    await expect(palette).toBeVisible();
    release();
    await expect(page).toHaveURL(new RegExp(`#/session/${session}(?:/|$)`));
    // The actor must not advance through an open dialog. Whether this
    // presentation retains that dialog on navigation is not this contract.
    if (await palette.isVisible()) {
      expect(await page.evaluate(ready, "")).toBe(false);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
    }
    await expect.poll(() => page.evaluate(ready, "")).toBe(true);
    await expect(page.getByText("native auth setup ready", { exact: true })).toBeVisible();
    await waitForRunIdle(request, harness, session);
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
    let servers = await openSettingsSection(page, "MCP servers");
    await expect(servers.getByRole("button", { name: "Add server", exact: true })).toBeVisible();
    await expect(servers.getByText("Loading…", { exact: true })).toHaveCount(0);
    await expect(
      servers.getByRole("button", {
        name: "external-auth-fixture",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(serverReads).toBe(before); // Raw fixture writes did not invalidate the warm query.
    await leaveSettings(page);
    await expect.poll(() => page.evaluate(ready, sessionRoute)).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(ready, sessionRoute)).toBe(true);
    servers = await openSettingsSection(page, "MCP servers");
    await expect(
      servers.getByRole("button", {
        name: "external-auth-fixture",
        exact: true,
      }),
    ).toBeVisible();
    // The manager opens on the newest stored server.
    await expect(servers.getByRole("button", { name: "Authenticate", exact: true })).toBeEnabled();
    // The only model request is the session's own first message.
    harness.provider.assertConsumed();
    expect(harness.provider.requests).toHaveLength(1);
  } finally {
    release();
  }
});
