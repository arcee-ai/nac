import { createSession, expect, showSidePanel, test, waitForRunIdle } from "./harness";
import { captureInspector } from "./inspector-evidence";

for (const width of [1440, 390]) {
  test(`inspector worksets preserve structured long content and read-only navigation at ${width}px`, async ({
    harness,
    page,
    request,
  }) => {
    const parent = await createSession(request, harness, "orchestrator");
    harness.provider.enqueue(
      "inspector-workset",
      { token: "INSPECTOR_WORKSET", requiredTools: ["workset_define"] },
      {
        kind: "function_call",
        name: "workset_define",
        callId: "inspector-workset",
        arguments: {
          id: "inspection-plan",
          goal: "Inspect the retained workflow without mutating its plan",
          status: "running",
          summary: "A structured plan remains readable across list and detail navigation.",
          verification_recipe:
            "Read each field, inspect the acceptance condition, and return to the list.\n".repeat(
              8,
            ),
          workset_items: [
            {
              title: "Retained verification item",
              scope: "Inspector presentation",
              description: "This description stays separate from scope and acceptance.",
              role: "verification",
              depends_on: [],
              acceptance: "Every structured field remains readable without editing the plan.",
            },
          ],
        },
      },
    );
    harness.provider.enqueue(
      "inspector-workset-finished",
      { functionOutputCallId: "inspector-workset" },
      { kind: "text", text: "Structured plan retained" },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${parent}/runs`, {
          data: { prompt: "INSPECTOR_WORKSET" },
        })
      ).status(),
    ).toBe(202);
    await waitForRunIdle(request, harness, parent);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const mutations: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      // Native model discovery uses a read-like POST with the provider configuration.
      const providerListing =
        sent.method() === "POST" &&
        url.origin === new URL(harness.baseUrl).origin &&
        url.pathname === "/providers/models";
      if (sent.method() !== "GET" && !url.pathname.startsWith("/assets/") && !providerListing)
        mutations.push(sent.url());
    });
    await page.goto(`${harness.baseUrl}/#/session/${parent}/worksets`);
    if (width < 768) {
      await page.getByRole("button", { name: "Open panel", exact: true }).click();
      await page.getByRole("button", { name: "inspection-plan", exact: true }).click();
    } else await showSidePanel(page);
    await expect(
      page.getByText("Inspect the retained workflow without mutating its plan", { exact: true }),
    ).toBeVisible();
    await captureInspector(page, `after-${width}-workset-structured-top`);
    const acceptance = page.getByText(
      "Every structured field remains readable without editing the plan.",
      { exact: true },
    );
    await acceptance.scrollIntoViewIfNeeded();
    await expect(acceptance).toBeVisible();
    await expect(page.getByText("Retained verification item", { exact: true })).toBeVisible();
    await captureInspector(page, `after-${width}-workset-structured-item`);
    expect(mutations).toEqual([]);
    harness.provider.assertConsumed();
  });
}
