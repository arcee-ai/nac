import fs from "node:fs/promises";
import path from "node:path";
import { createSession, expect, test, waitForRunIdle } from "./harness";

test.skip(!!process.env.NAC_E2E_REMOTE, "Uses only the isolated scripted provider");
test.use({ managedNativeWeb: false });

function toolOutput(value: unknown, callId: string): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => toolOutput(item, callId)).find(Boolean);
  }
  if (value === null || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  if (
    object.type === "function_call_output" &&
    object.call_id === callId &&
    typeof object.output === "string"
  ) {
    return object.output;
  }
  return Object.values(object)
    .map((item) => toolOutput(item, callId))
    .find(Boolean);
}

for (const mobile of [false, true]) {
  test(`joined installed guide and scoped navigation on ${mobile ? "phone" : "desktop"}`, async ({
    harness,
    request,
    page,
  }, info) => {
    const id = await createSession(request, harness, "direct");
    const get = async (route: string) => {
      const response = await request.get(`${harness.baseUrl}${route}`);
      expect(response.ok(), route).toBe(true);
      return response.json();
    };
    const initialConfig = await get(`/sessions/${id}/config`);
    const initialMcp = await get("/mcp_library/servers");
    const initialFacts = await get(`/product-context?session_id=${id}`);
    expect(await get(`/sessions/${id}/skills`)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "nac-help",
          description: expect.stringContaining("first-party"),
        }),
      ]),
    );
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    const originalUrl = page.url();
    const mutations: string[] = [];
    page.on("request", (event) => {
      const route = new URL(event.url()).pathname;
      const passivePost =
        event.method() === "POST" &&
        ["/product-destinations/resolve", "/providers/models"].includes(route);
      if (event.method() !== "GET" && !passivePost) mutations.push(`${event.method()} ${route}`);
    });
    const prompt =
      "How do I add MCP? Cite the installed NAC Guide and show how to open MCP settings.";
    const calls = [
      {
        step: "guide-index",
        name: "nac_guide",
        arguments: { operation: "index", query: "add MCP" },
      },
      {
        step: "guide-section",
        name: "nac_guide",
        arguments: { operation: "read", document_id: "mcp", section_id: "add-a-server" },
      },
      { step: "runtime-context", name: "get_product_context", arguments: {} },
      {
        step: "destination",
        name: "resolve_product_destination",
        arguments: { destination: "mcp-settings", expected_build_id: initialFacts.build.build_id },
      },
      {
        step: "stale-guide",
        name: "nac_guide",
        arguments: { operation: "manifest", expected_fingerprint: "0".repeat(64) },
      },
      {
        step: "stale-build",
        name: "resolve_product_destination",
        arguments: {
          destination: "mcp-settings",
          expected_build_id: "stale-build-that-is-not-installed",
        },
      },
    ];
    for (const [index, call] of calls.entries()) {
      harness.provider.enqueue(
        call.step,
        index === 0
          ? {
              token: prompt,
              requiredTools: ["nac_guide", "get_product_context", "resolve_product_destination"],
              forbiddenTools: ["web_search", "web_fetch"],
            }
          : { functionOutputCallId: calls[index - 1].step },
        {
          kind: "function_call",
          stream: "request",
          name: call.name,
          callId: call.step,
          arguments: call.arguments,
        },
      );
    }
    const answer = `NAC Guide mcp#add-a-server, installed ${initialFacts.build.product_version}: configure mcp_servers. Current facts come from installed-runtime. Open NAC capabilities, then MCP settings; nothing has opened automatically.`;
    harness.provider.enqueue(
      "cited-answer",
      { functionOutputCallId: "stale-build" },
      { kind: "text", stream: "request", text: answer },
    );
    const admitted = await request.post(`${harness.baseUrl}/sessions/${id}/runs`, {
      data: { prompt },
    });
    expect(admitted.status()).toBe(202);
    await harness.provider.waitForRequestCount(7);
    await waitForRunIdle(request, harness, id);
    harness.provider.assertConsumed();
    const output = (callId: string, nextStep: string) => {
      const body = harness.provider.requests.find((item) => item.matchedStep === nextStep)?.body;
      const text = toolOutput(body, callId);
      expect(text, `actual native output for ${callId}`).toBeDefined();
      return text!;
    };
    const index = JSON.parse(output("guide-index", "guide-section"));
    const section = JSON.parse(output("guide-section", "runtime-context"));
    const context = JSON.parse(output("runtime-context", "destination"));
    const destination = JSON.parse(output("destination", "stale-guide"));
    const staleGuide = JSON.parse(output("stale-guide", "stale-build"));
    const staleBuild = output("stale-build", "cited-answer");
    expect(index.result.hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ document_id: "mcp" })]),
    );
    expect(index.provenance).toBe("first-party bundled NAC Guide");
    expect(index.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(section.fingerprint).toBe(index.fingerprint);
    expect(section.provenance).toBe(index.provenance);
    expect(section.result.reference).toEqual({ document_id: "mcp", section_id: "add-a-server" });
    expect(section.result.content_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(section.result.text).toContain("mcp_servers");
    expect(section.build_identity).toEqual(index.build_identity);
    expect(section.build_identity).toEqual(initialFacts.build);
    expect(context.build).toEqual(initialFacts.build);
    expect(context.source).toBe("installed-runtime");
    expect(context.session.session_id).toBe(id);
    expect(context.session.execution_backend).toBe("local");
    expect(destination.build).toEqual(context.build);
    expect(destination.session_id).toBe(id);
    expect(destination.target.destination).toBe("mcp-settings");
    expect(destination.target.availability).toBe("available");
    expect(destination.opened).toBe(false);
    expect(staleGuide.status).toBe("version_mismatch");
    expect(staleGuide.fingerprint).toBe(index.fingerprint);
    expect(staleBuild).toContain("Product context or destination unavailable");
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    const mcpDialog = page.getByRole("dialog", { name: "MCP servers", exact: true });
    await expect(mcpDialog).toHaveCount(0);
    await expect(page).toHaveURL(originalUrl);
    await page.evaluate("document.fonts.ready.then(() => true)");
    await page.screenshot({ path: info.outputPath("cited-help.png"), animations: "disabled" });
    if (mobile) await page.getByRole("button", { name: "Open the menu", exact: true }).click();
    await page.getByRole("button", { name: "NAC capabilities", exact: true }).click();
    const capabilities = page.getByRole("dialog", { name: "NAC capabilities", exact: true });
    await expect(capabilities).toBeVisible();
    await expect(capabilities.getByText(context.build.build_id, { exact: true })).toBeVisible();
    const openMcp = capabilities.getByRole("button", { name: "Open MCP settings", exact: true });
    await openMcp.focus();
    await page.keyboard.press("Enter");
    await expect(mcpDialog).toBeVisible();
    await page.screenshot({ path: info.outputPath("explicit-mcp.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(mcpDialog).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          "!!document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('[inert]')",
        ),
      )
      .toBe(true);
    await expect(page).toHaveURL(originalUrl);
    expect(await get(`/sessions/${id}/config`)).toEqual(initialConfig);
    expect(await get("/mcp_library/servers")).toEqual(initialMcp);
    expect(
      (await get("/sessions")).map(
        (item: { summary: { session_id: string; run_count: number } }) => [
          item.summary.session_id,
          item.summary.run_count,
        ],
      ),
    ).toEqual([[id, 1]]);
    expect(mutations).toEqual([]);
    const evidence = {
      kind: "deterministic model-wire/native/browser composition; no actual vendor selection claim",
      session_id: id,
      viewport: mobile ? "phone" : "desktop",
      build: context.build,
      native: { index, section, context, destination, staleGuide, staleBuild },
      no_mutation: {
        browser_mutations: mutations,
        config_unchanged: true,
        mcp_inventory_unchanged: true,
        sessions: 1,
        runs: 1,
      },
    };
    await fs.writeFile(info.outputPath("joined-evidence.json"), JSON.stringify(evidence, null, 2));
    if (process.env.NAC_PRODUCT_CONTEXT_CAPTURES) {
      const root = process.env.NAC_PRODUCT_CONTEXT_CAPTURES;
      await fs.mkdir(root, { recursive: true });
      for (const name of ["cited-help.png", "explicit-mcp.png", "joined-evidence.json"]) {
        await fs.copyFile(
          info.outputPath(name),
          path.join(root, `${mobile ? "phone" : "desktop"}-${name}`),
        );
      }
    }
  });
}
