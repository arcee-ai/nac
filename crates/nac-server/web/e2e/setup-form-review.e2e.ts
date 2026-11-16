import fs from "node:fs/promises";
import { createProject, expect, test } from "./harness";
import { openNameZoom } from "./session-name-zoom";
import { installSetupFixture, longModel } from "./setup-visual-fixture";

test.use({ orchestration: "0", hasTouch: true });
test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local form fixture");

for (const zoomed of [false, true]) {
  test(`reviewed form text and saved validation at ${zoomed ? "real200percent195CSS" : "390CSS"}`, async ({
    harness,
    page: defaultPage,
    request,
  }, info) => {
    test.setTimeout(90_000);
    const zoom = zoomed ? await openNameZoom(info, harness.baseUrl) : null;
    const page = zoom?.page ?? defaultPage;
    const textMeasurements: Array<{ state: string; result: unknown }> = [];
    try {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await installSetupFixture(page, request, harness, 390);
      await page.goto(harness.baseUrl);
      expect(
        await page.locator("html").evaluate((node) => node.ownerDocument.defaultView!.innerWidth),
      ).toBe(zoomed ? 195 : 390);
      const checkText = async (button: ReturnType<typeof page.getByRole>, state: string) => {
        const result = await button.evaluate(async (node) => {
          const document = node.ownerDocument;
          const window = document.defaultView!;
          await document.fonts.ready;
          const box = node.getBoundingClientRect();
          const walker = document.createTreeWalker(node, 4);
          const texts = [];
          while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            texts.push({
              text: text.textContent,
              rectangles: [...range.getClientRects()].map((r) => ({
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
              })),
            });
          }
          return {
            whiteSpace: window.getComputedStyle(node).whiteSpace,
            box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
            texts,
            pageWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          };
        });
        textMeasurements.push({ state, result });
        expect(result.pageWidth).toBeLessThanOrEqual(result.viewport + 1);
        for (const text of result.texts)
          for (const rect of text.rectangles) {
            expect(rect.left).toBeGreaterThanOrEqual(result.box.left - 0.5);
            expect(rect.right).toBeLessThanOrEqual(result.box.right + 0.5);
            expect(rect.top).toBeGreaterThanOrEqual(result.box.top - 0.5);
            expect(rect.bottom).toBeLessThanOrEqual(result.box.bottom + 0.5);
          }
        return result;
      };
      const inspectModelSetup = async (
        dialog: ReturnType<typeof page.getByRole>,
        state: string,
      ) => {
        const primary = dialog.getByRole("group", { name: "Model*", exact: true });
        await primary.getByRole("button").click();
        await page
          .getByRole("group", { name: "Model results", exact: true })
          .getByRole("button")
          .filter({ hasText: longModel })
          .click();
        await checkText(primary.getByRole("button"), `${state}-selected-model-provider`);
        const advanced = dialog.getByRole("button", {
          name: "Advanced presets and provider setup",
          exact: true,
        });
        await advanced.scrollIntoViewIfNeeded();
        const wrapping = await checkText(advanced, `${state}-advanced-action`);
        expect(wrapping.whiteSpace).toBe("normal"); // Real CSS cascade, not a class-string assertion.
      };
      await page.getByRole("button", { name: "Get Started", exact: true }).click();
      const project = page.getByRole("dialog", { name: "New Project", exact: true });
      await inspectModelSetup(project, "project");
      await project.getByRole("button", { name: "Close", exact: true }).click();
      expect(
        (await (await request.get(`${harness.baseUrl}/projects`)).json()).projects,
      ).toHaveLength(0);
      const id = await createProject(request, harness);
      await page.goto(`${harness.baseUrl}/#/project/${id}`);
      await page.reload();
      const chat = page.getByRole("dialog", { name: "New Chat", exact: true });
      await expect(chat).toBeVisible();
      await inspectModelSetup(chat, "chat");
      await chat.getByRole("button", { name: "Close", exact: true }).click();
      const menu = page.getByRole("button", { name: "Open the menu", exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole("button", { name: "Configurations", exact: true }).click();
      const configurations = page.getByRole("dialog", { name: "Configurations", exact: true });
      const name = configurations.getByRole("textbox", { name: "Configuration name", exact: true });
      await expect(name).toHaveValue("E2E scripted provider");
      const changes: unknown[] = [];
      let reject = true;
      await page.route(`${harness.baseUrl}/model-configs/*`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        changes.push(route.request().postDataJSON());
        if (reject)
          return route.fulfill({
            status: 422,
            json: { error: "Controlled configuration save failed." },
          });
        return route.continue();
      });
      await name.fill("");
      await configurations.getByRole("button", { name: "Save", exact: true }).click();
      await expect(name).toBeFocused();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      const description = await name.getAttribute("aria-describedby");
      expect(description).toBeTruthy();
      const error = configurations.getByRole("alert").filter({ hasText: "A name is required." });
      await expect(error).toBeVisible();
      expect(await error.getAttribute("id")).toBe(description);
      expect(changes).toEqual([]);
      const fieldGeometry = await name.evaluate((node) => {
        const owner = node.closest('[data-slot="dialog-content"], [data-slot="sheet-content"]')!;
        const footer = owner.querySelector("footer")!.getBoundingClientRect();
        const field = node.getBoundingClientRect();
        const message = node.ownerDocument
          .getElementById(node.getAttribute("aria-describedby")!)!
          .getBoundingClientRect();
        return {
          field: { top: field.top, bottom: field.bottom },
          message: { top: message.top, bottom: message.bottom },
          footerTop: footer.top,
        };
      });
      expect(fieldGeometry.message.top).toBeGreaterThanOrEqual(fieldGeometry.field.bottom);
      expect(fieldGeometry.message.bottom).toBeLessThanOrEqual(fieldGeometry.footerTop);
      await name.fill("Reviewed retry draft");
      await expect(name).not.toHaveAttribute("aria-invalid", "true");
      await configurations.getByRole("button", { name: "Save", exact: true }).click();
      const saveError = configurations.getByRole("alert").filter({
        hasText:
          "The request was rejected. One or more request parameters are invalid or out of range.",
      });
      await expect(saveError).toBeFocused();
      await expect(saveError).toBeInViewport();
      await expect(name).toHaveValue("Reviewed retry draft");
      reject = false;
      await configurations.getByRole("button", { name: "Save", exact: true }).click();
      await expect(configurations.getByRole("alert")).toHaveCount(0);
      expect(changes).toHaveLength(2);
      expect(changes[0]).toEqual(changes[1]);
      await configurations.getByRole("button", { name: "Cancel", exact: true }).click();
      const file = info.outputPath("reviewed-form-regressions.json");
      await fs.writeFile(
        file,
        JSON.stringify(
          {
            textMeasurements,
            fieldGeometry,
            changes,
            zoom: zoom?.zoom ?? 1,
            physicalDevice: false,
            screenReader: false,
          },
          null,
          2,
        ),
      );
      await info.attach("reviewed-form-regressions.json", {
        path: file,
        contentType: "application/json",
      });
    } finally {
      await zoom?.context.close();
    }
  });
}
