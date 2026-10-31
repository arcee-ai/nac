import http from "node:http";
import type { APIRequestContext } from "@playwright/test";
import { createSession, expect, test, waitForRunIdle, type EmbeddedHarness } from "./harness";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires disposable local MCP and model fixtures");
test.use({ orchestration: "0" });
const ECHO = "mcp__refresh_fixture__echo";

async function mcpFixture() {
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { id?: number; method: string };
    if (body.id == null) {
      response.writeHead(202).end();
      return;
    }
    const result =
      body.method === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "refresh-fixture", version: "1" },
            instructions: "Use the generic echo fixture only for this disposable test.",
          }
        : body.method === "tools/list"
          ? {
              tools: [
                {
                  name: "echo",
                  description: "Echo a fixture value",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            }
          : body.method === "tools/call"
            ? (calls++, { content: [{ type: "text", text: "fixture echoed exactly once" }] })
            : {};
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("fixture did not bind");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls: () => calls,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function run(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  session: string,
  prompt: string,
) {
  const response = await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
    data: { prompt },
  });
  expect(response.status()).toBe(202);
  await waitForRunIdle(request, harness, session);
}

for (const mobile of [false, true]) {
  test(`refreshes an existing chat after connect and removal (${mobile ? "phone" : "desktop"})`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await mcpFixture();
    try {
      const session = await createSession(request, harness, "direct");
      harness.provider.enqueue(
        "before-mount",
        { token: "REFRESH_BEFORE", forbiddenTools: [ECHO] },
        { kind: "text", text: "Chat predates integration" },
      );
      await run(request, harness, session, "REFRESH_BEFORE");
      const added = await request.post(`${harness.baseUrl}/mcp_library/servers`, {
        data: {
          name: "refresh_fixture",
          enabled: true,
          required: false,
          transport: "streamable_http",
          url: fixture.url,
          headers: {},
          args: [],
          env: {},
          approval: "allow",
        },
      });
      expect(added.status()).toBe(201);
      expect(
        (await request.post(`${harness.baseUrl}/mcp_library/servers/refresh_fixture/connect`)).ok(),
      ).toBe(true);
      await page.goto(`${harness.baseUrl}/#/session/${session}/threads`);
      await page.getByRole("button", { name: "Chat integrations", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Chat integrations", exact: true });
      await expect(panel).toBeVisible();
      await panel.getByRole("button", { name: "Refresh integrations", exact: true }).click();
      await expect(panel.getByRole("status")).toHaveText(
        "Changes will apply before the next model request.",
      );
      await page.screenshot({
        path: testInfo.outputPath(`integrations-pending-${mobile ? "phone" : "desktop"}.png`),
      });
      expect(fixture.calls()).toBe(0);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Chat integrations", exact: true }),
      ).toBeFocused();

      harness.provider.enqueue(
        "new-mount",
        { token: "REFRESH_ADDED", requiredTools: [ECHO] },
        { kind: "function_call", name: ECHO, callId: "refresh-echo", arguments: {} },
      );
      harness.provider.enqueue(
        "after-echo",
        { functionOutputCallId: "refresh-echo" },
        { kind: "text", text: "New integration completed" },
      );
      await run(request, harness, session, "REFRESH_ADDED");
      expect(fixture.calls()).toBe(1);
      await page.getByRole("button", { name: "Chat integrations", exact: true }).click();
      await expect(panel.getByRole("status")).toHaveText("Integrations are current for this chat.");
      await expect(panel.getByText("Refresh 1 · Applied 1", { exact: true })).toBeVisible();
      expect(
        (await request.delete(`${harness.baseUrl}/mcp_library/servers/refresh_fixture`)).ok(),
      ).toBe(true);
      await panel.getByRole("button", { name: "Refresh integrations", exact: true }).click();
      await expect(panel.getByRole("status")).toHaveText(
        "Changes will apply before the next model request.",
      );
      harness.provider.enqueue(
        "removed-mount",
        { token: "REFRESH_REMOVED", forbiddenTools: [ECHO] },
        { kind: "text", text: "Removed integration is absent" },
      );
      await run(request, harness, session, "REFRESH_REMOVED");
      await expect(panel.getByText("Refresh 2 · Applied 2", { exact: true })).toBeVisible();
      expect(fixture.calls()).toBe(1);
      await page.keyboard.press("Escape");
      await harness.restart("0");
      harness.provider.enqueue(
        "restart-no-replay",
        { token: "REFRESH_RESTART", forbiddenTools: [ECHO] },
        { kind: "text", text: "Restart retained refresh intent" },
      );
      await run(request, harness, session, "REFRESH_RESTART");
      expect(fixture.calls()).toBe(1);
      harness.provider.assertConsumed();
    } finally {
      await fixture.stop();
    }
  });
}
