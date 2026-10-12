import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { startHostedFixture } from "./hosted-fixture";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local scripted harness");

for (const mobile of [false, true]) {
  test(`native injected presentation lifecycle ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness);
    const sessionId = await createSession(request, harness, "direct", project);
    const fixture = await startHostedFixture(harness, sessionId);
    try {
      await page.goto(fixture.baseUrl);
      const composer = page.getByRole("combobox", { name: "Message" });
      await expect(composer).toBeVisible();
      const callerLocation = page.url();
      if (mobile) {
        const bounds = await page.locator("[data-nac-runtime]").boundingBox();
        const header = await page.locator("header").boundingBox();
        expect(bounds).not.toBeNull();
        expect(header!.y).toBeGreaterThanOrEqual(bounds!.y);
      }
      harness.provider.enqueue(
        "hosted-complete",
        { token: "HOSTED_NATIVE_FIXTURE" },
        { kind: "text", text: "native injected response", stream: true },
      );
      await composer.fill("HOSTED_NATIVE_FIXTURE");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await waitForRunIdle(request, harness, sessionId);
      await expect(page.getByText("native injected response", { exact: true })).toBeVisible();
      await composer.fill("draft before replacement");
      await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
      await expect(composer).toHaveValue("");
      await expect(page.getByText("native injected response", { exact: true })).toBeVisible();
      expect(page.url()).toBe(callerLocation);
      expect(
        fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/runs")),
      ).toHaveLength(1);
      expect(fixture.calls.filter((call) => call.path.includes("/events/stream"))).toHaveLength(2);
      expect(fixture.calls.some((call) => call.path === "/projects")).toBe(true);
      await page.getByRole("button", { name: "Close runtime", exact: true }).click();
      await expect(composer).toHaveCount(0);
      await expect(page.locator("[data-nac-runtime]")).toHaveCount(0);
      harness.provider.assertConsumed();
      if (mobile)
        expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
          390,
        );
    } finally {
      await fixture.stop();
    }
  });
}
