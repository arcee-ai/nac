import fs from "node:fs/promises";
import { createProject, expect, test } from "./harness";
import { openNameZoom } from "./session-name-zoom";
import { installSetupFixture, longModel } from "./setup-visual-fixture";

test.use({ hasTouch: true });
test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local form fixture");

for (const zoomed of [false, true]) {
  test(`reviewed session model form text at ${zoomed ? "real200percent195CSS" : "390CSS"}`, async ({
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
        const connections = dialog.getByRole("button", {
          name: "Provider connections",
          exact: true,
        });
        await connections.scrollIntoViewIfNeeded();
        await checkText(connections, `${state}-provider-connections`);
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
      // An empty project opens Home's composer; its model chip holds the
      // per-session model setup the New Chat dialog used to.
      await expect(page).toHaveURL(new RegExp(`#/\\?project=${id}$`));
      await page
        .getByRole("button", { name: /^(?:Model: .+|Choose a model)$/ })
        .first()
        .click();
      const chat = page.getByRole("dialog", { name: "Model for this session", exact: true });
      await expect(chat).toBeVisible();
      await inspectModelSetup(chat, "chat");
      await chat.getByRole("button", { name: "Close", exact: true }).click();
      await expect(chat).toHaveCount(0);
      const file = info.outputPath("reviewed-form-regressions.json");
      await fs.writeFile(
        file,
        JSON.stringify(
          {
            textMeasurements,
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
