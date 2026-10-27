import { createSession, expect, startForegroundChild, test } from "./harness";

for (const mode of ["child", "orchestrator"] as const) {
  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 720 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    test(`recovers an uncertain ${mode} message with pointer controls on ${name}`, async ({
      harness,
      page,
      request,
    }) => {
      const token = `E2E_RECOVERY_${mode}_${name}`;
      harness.provider.enqueue(token, { token }, { kind: "text", text: "initial run completed" });
      const parentId = await createSession(
        request,
        harness,
        mode === "child" ? "direct" : "direct-with-orchestrator",
      );
      const endpoint = `${harness.baseUrl}/sessions/${parentId}/${mode === "child" ? "children" : "orchestrators"}`;
      const response =
        mode === "child"
          ? await startForegroundChild(request, harness, parentId, "Recovery target", token)
          : await request.post(endpoint, {
              data: { description: "Recovery target", prompt: token, background: false },
            });
      expect(response.status()).toBe(201);
      const record = await response.json();
      const targetId = mode === "child" ? record.child_session_id : record.orchestrator_session_id;
      let attempts = 0;
      await page.route(endpoint, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        attempts += 1;
        await route.fulfill({ status: 503, body: "response unavailable" });
      });
      await page.setViewportSize(viewport);
      await page.goto(`${harness.baseUrl}/#/session/${targetId}`);
      const field = page.getByRole("textbox", { name: "Send a message" });
      await field.fill("Keep this exact recovery message");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const recovery = page.getByRole("region", { name: "Subagent message delivery" });
      await expect(recovery).toContainText("Message delivery is unconfirmed");
      for (const label of ["Restore to composer", "Copy message", "Dismiss"]) {
        await expect(recovery.getByRole("button", { name: label })).toHaveCSS(
          "pointer-events",
          "auto",
        );
      }
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {},
          },
        });
      });
      await recovery.getByRole("button", { name: "Copy message" }).click();
      await expect(recovery.getByRole("button", { name: "Copied" })).toBeVisible();
      await recovery.getByRole("button", { name: "Restore to composer" }).click();
      await expect(field).toHaveValue("Keep this exact recovery message");
      await expect(recovery).toHaveCount(0);
      expect(attempts).toBe(1);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(recovery).toContainText("Message delivery is unconfirmed");
      await field.fill("Preserve my next draft");
      await expect(recovery.getByRole("button", { name: "Restore to composer" })).toBeDisabled();
      await recovery.getByRole("button", { name: "Dismiss" }).click();
      await expect(recovery).toHaveCount(0);
      await expect(field).toHaveValue("Preserve my next draft");
      expect(attempts).toBe(2);
      harness.provider.assertConsumed();
    });
  }
}
