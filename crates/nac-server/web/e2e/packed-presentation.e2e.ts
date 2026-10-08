import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { startPackedPresentation } from "./packed-presentation-fixture";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local scripted packed consumer");
test.use({ orchestration: "0" });
for (const mobile of [false, true]) {
  test(`packed native presentation with caller router/style isolation ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }, info) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    // No constructable stylesheet or CSSScopeRule is available in this fixture.
    // Formula styles must use the legacy, inert, local CSSOM parser instead.
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, "CSSScopeRule", { value: undefined, configurable: true });
      const browser = globalThis as unknown as { CSSStyleSheet: { prototype: object } };
      Object.defineProperty(browser.CSSStyleSheet.prototype, "replaceSync", {
        value: undefined,
        configurable: true,
      });
    });
    const project = await createProject(request, harness);
    const id = await createSession(request, harness, "direct", project);
    const fixture = await startPackedPresentation(harness, id);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fontResponses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/native-assets/")) fontResponses.push(response.status());
    });
    try {
      await page.goto(fixture.baseUrl);
      const callerLocation = page.url();
      const sentinel = page.locator("#sentinel");
      const callerStyles = () =>
        sentinel.evaluate((node) => {
          const browser = globalThis as unknown as {
            document: { body: unknown; documentElement: unknown };
            getComputedStyle: (element: unknown) => {
              padding: string;
              borderRadius: string;
              fontFamily: string;
              color: string;
              margin: string;
              backgroundColor: string;
              getPropertyValue: (name: string) => string;
            };
          };
          const style = browser.getComputedStyle(node),
            body = browser.getComputedStyle(browser.document.body);
          return {
            padding: style.padding,
            radius: style.borderRadius,
            font: style.fontFamily,
            color: style.color,
            margin: body.margin,
            background: body.backgroundColor,
            brand: browser
              .getComputedStyle(browser.document.documentElement)
              .getPropertyValue("--brand-500"),
          };
        });
      const expected = {
        padding: "11px",
        radius: "13px",
        font: "monospace",
        color: "rgb(6, 7, 8)",
        margin: "17px",
        background: "rgb(111, 22, 33)",
        brand: "caller-brand",
      };
      await expect.poll(callerStyles).toEqual(expected);
      const composer = page.getByRole("combobox", { name: "Message" });
      await expect(composer).toBeVisible();
      const nativeStyles = await page.locator("[data-nac-runtime]").evaluate((node) => {
        const browser = globalThis as unknown as {
          getComputedStyle: (element: unknown) => {
            fontFamily: string;
            backgroundColor: string;
            getPropertyValue: (name: string) => string;
          };
        };
        const style = browser.getComputedStyle(node);
        return {
          font: style.fontFamily,
          background: style.backgroundColor,
          brand: style.getPropertyValue("--brand-500").trim(),
        };
      });
      expect(nativeStyles.font).toContain("NACPresentationInter");
      expect(nativeStyles.background).toBe("rgb(15, 16, 16)");
      expect(nativeStyles.brand).toBe("#008c8c");
      harness.provider.enqueue(
        "packed-math",
        { token: "PACKED_NATIVE_MATH" },
        { kind: "text", text: "Packed native complete with $x^2+1$.", stream: true },
      );
      await composer.fill("PACKED_NATIVE_MATH");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await waitForRunIdle(request, harness, id);
      await expect(page.locator("[data-nac-runtime] mjx-container")).toHaveCount(1);
      await expect.poll(() => fontResponses.length).toBeGreaterThan(0);
      expect(fontResponses.every((status) => status === 200)).toBe(true);
      const formulaStyles = await page.locator("[data-nac-runtime] style").allTextContents();
      expect(formulaStyles.length).toBeGreaterThan(0);
      expect(formulaStyles.every((css) => !css.includes("@scope"))).toBe(true);
      expect(formulaStyles.join("\n")).toContain('[data-nac-runtime="');
      await expect(page.locator("[data-nac-overlays] style")).toHaveCount(0);
      const formulaStyle = await page.locator("[data-nac-runtime] mjx-math").evaluate((node) => {
        const browser = globalThis as unknown as {
          getComputedStyle: (element: unknown) => { fontFamily: string };
        };
        return browser.getComputedStyle(node).fontFamily;
      });
      expect(formulaStyle).toMatch(/NAC\d+MJX/);
      const callerFormulaStyle = () =>
        page.locator("#caller-math mjx-container").evaluate((node) => {
          const browser = globalThis as unknown as {
            getComputedStyle: (element: unknown) => { fontFamily: string; lineHeight: string };
          };
          const style = browser.getComputedStyle(node);
          return { font: style.fontFamily, lineHeight: style.lineHeight };
        });
      await expect.poll(callerFormulaStyle).toEqual({ font: "monospace", lineHeight: "19px" });
      await page.getByRole("button", { name: "Session settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
      await expect(settings).toBeVisible();
      await sentinel.click();
      await page.keyboard.press("Escape");
      await expect(settings).toBeVisible();
      await settings.getByRole("textbox", { name: "Session title", exact: true }).focus();
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      await composer.fill("old packed draft");
      await page.getByRole("button", { name: "Replace packed runtime", exact: true }).click();
      await expect(composer).toHaveValue("");
      await expect(page.locator("[data-nac-runtime] mjx-container")).toHaveCount(1);
      await expect(page.getByLabel("Product location")).toHaveText("/");
      expect(page.url()).toBe(callerLocation);
      await expect.poll(callerStyles).toEqual(expected);
      expect(
        fixture.calls.filter((call) => call.method === "POST" && call.path.endsWith("/runs")),
      ).toHaveLength(1);
      await page.getByRole("button", { name: "Close packed runtime", exact: true }).click();
      await expect(page.locator("[data-nac-runtime]")).toHaveCount(0);
      await expect(page.locator('head style[data-precedence="mathjax"]')).toHaveCount(0);
      await expect.poll(callerFormulaStyle).toEqual({ font: "monospace", lineHeight: "19px" });
      await expect.poll(callerStyles).toEqual(expected);
      expect(errors).toEqual([]);
      harness.provider.assertConsumed();
      await info.attach("packed presentation qualification", {
        contentType: "application/json",
        body: JSON.stringify({
          integrity: fixture.integrity,
          peers: fixture.peerVersions,
          fontResponses,
          formulaStyle,
          formulaStyles,
          viewport: page.viewportSize(),
          calls: fixture.calls,
          proof:
            "Clean tarball consumer; scoped CSS/assets, separate caller root with BrowserRouter/MemoryRouter, one scripted admission, replacement/close. No actual gateway identity, custody or Dev2 acceptance.",
        }),
      });
    } finally {
      await fixture.stop();
    }
  });
}

test("standalone native formula keeps its existing font and hoisted style behavior", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const id = await createSession(request, harness, "direct", project);
  const fontResponses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/assets/mathjax-")) fontResponses.push(response.status());
  });
  harness.provider.enqueue(
    "standalone-math",
    { token: "STANDALONE_NATIVE_MATH" },
    { kind: "text", text: "Standalone native formula $x^2+1$.", stream: true },
  );
  await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
  await page.getByRole("combobox", { name: "Message" }).fill("STANDALONE_NATIVE_MATH");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await waitForRunIdle(request, harness, id);
  await expect(page.locator("mjx-container")).toHaveCount(1);
  await expect.poll(() => fontResponses.length).toBeGreaterThan(0);
  expect(fontResponses.every((status) => status === 200)).toBe(true);
  await expect
    .poll(() => page.locator('head style[data-precedence="mathjax"]').count())
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator("mjx-container")).toHaveCount(1);
  expect(fontResponses.every((status) => status === 200)).toBe(true);
  harness.provider.assertConsumed();
});
