import path from "node:path";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";

// Explicit capture runs use the same fixture against the base and head binaries.
// Normal E2E runs do not register this evidence-only scenario.
if (process.env.NAC_VISUAL_DIR && process.env.NAC_VISUAL_LABEL) {
  test.use({ codexCatalogFixture: true });
  for (const mobile of [false, true]) {
    test(`capture Codex context ${mobile ? "mobile" : "desktop"}`, async ({
      harness,
      page,
      request,
    }) => {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      const sessionId = await createDirectSession(request, harness);
      harness.provider.enqueue(
        "visual-context",
        { token: "CONTEXT_VISUAL" },
        {
          kind: "text",
          text: "Context fixture",
          usage: { input_tokens: 40_597, output_tokens: 3, total_tokens: 40_600 },
        },
      );
      expect(
        (
          await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
            data: { prompt: "CONTEXT_VISUAL" },
          })
        ).ok(),
      ).toBeTruthy();
      await waitForRunIdle(request, harness, sessionId);
      await page.route(`${harness.baseUrl}/providers/models`, async (route) => {
        if (route.request().postDataJSON().backend !== "chatgpt-codex-responses")
          return route.fallback();
        await route.fulfill({
          json: {
            base_url: "https://chatgpt.com/backend-api",
            models: [{ id: "gpt-6.1-sol", display_name: "GPT-6.1-Sol" }],
            api_key_env: null,
          },
        });
      });
      await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
      await page.getByRole("button", { name: "Model" }).click();
      await page.getByPlaceholder("Search models…").fill("gpt-6.1-sol");
      await page.getByRole("button", { name: /GPT-6\.1-Sol gpt-6\.1-sol/ }).click();
      await expect
        .poll(
          async () =>
            (await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json())
              .model,
        )
        .toBe("gpt-6.1-sol");
      await page
        .getByRole("button", { name: mobile ? "Open panel" : "Session menu", exact: true })
        .click();
      const reading = page.getByText(
        /of (the model's effective input budget|chatgpt-codex-responses's default window)/,
      );
      await expect(reading).toBeVisible();
      await expect(reading).toContainText(process.env.NAC_VISUAL_LABEL === "before" ? "32%" : "9%");
      await reading.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          process.env.NAC_VISUAL_DIR!,
          `${process.env.NAC_VISUAL_LABEL}-${mobile ? "mobile" : "desktop"}.png`,
        ),
      });
    });
  }
}
