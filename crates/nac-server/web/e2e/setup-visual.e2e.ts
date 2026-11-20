import { expect, test } from "./harness";
import { homeComposer, openModelList } from "./focus-embedded-helpers";
import {
  captureSetup,
  installSetupFixture,
  withSetupBaselines,
  setupBaseline,
} from "./setup-visual-fixture";
import { openNameZoom } from "./session-name-zoom";

test.use({ orchestration: "0", hasTouch: true });
test.skip(!!process.env.NAC_E2E_REMOTE, "Requires disposable local setup commands");

for (const width of [1440, 768, 390]) {
  test(`project location form, folder selection and settled commands at ${width}px`, async ({
    harness,
    page,
    request,
  }, info) =>
    withSetupBaselines(async (baseline) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await baseline.serve(page, harness.baseUrl);
      let releaseCatalog!: () => void;
      const catalogReady = new Promise<void>((resolve) => {
        releaseCatalog = resolve;
      });
      const { folder } = await installSetupFixture(page, request, harness, width, catalogReady);
      await page.goto(harness.baseUrl);
      const start = page.getByRole("button", { name: "Get Started", exact: true });
      await start.click();
      const dialog = page.getByRole("dialog", { name: "New Project", exact: true });
      const launch = dialog.getByRole("button", { name: "Create Project", exact: true });
      const pickBaselineModel = async () => {
        if (setupBaseline()) {
          await dialog.getByRole("button", { name: "Select a model", exact: true }).click();
          await page.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
        }
      };
      if (setupBaseline()) {
        await expect(
          dialog.getByRole("button", { name: "Loading models…", exact: true }),
        ).toBeDisabled();
      } else {
        await expect(dialog.getByRole("region", { name: "Location" })).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "Project name" })).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "Select a model", exact: true }),
        ).toHaveCount(0);
        await expect(launch).toBeEnabled();
      }
      await captureSetup(page, info, width, "loading-models");
      releaseCatalog();
      await captureSetup(page, info, width, "default");
      await info.attach("setup-accessibility-semantics.txt", {
        body: await dialog.ariaSnapshot(),
        contentType: "text/plain",
      });
      if (setupBaseline()) await pickBaselineModel();
      await dialog.getByPlaceholder("Taken from the git remote").fill("Launch fixture");
      const folderButton = dialog
        .getByRole("button", { name: new RegExp(`Working Folder|${folder}`) })
        .first();
      await folderButton.click();
      const picker = page.getByRole("dialog", {
        name: setupBaseline() ? "Select Working Folder" : "Choose a folder",
        exact: true,
      });
      await expect(picker).toBeVisible();
      await captureSetup(page, info, width, "path-selector");
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(folderButton).toBeFocused();
      await expect(dialog.getByPlaceholder("Taken from the git remote")).toHaveValue(
        "Launch fixture",
      );
      // Canceling the outer form does not launch or create anything.
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(
        (await (await request.get(`${harness.baseUrl}/projects`)).json()).projects,
      ).toHaveLength(0);
      await start.click();
      if (setupBaseline()) await pickBaselineModel();
      await expect(launch).toBeEnabled();
      await dialog.getByPlaceholder("Taken from the git remote").fill("Launch fixture");
      let projects = 0;
      let sessions = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`${harness.baseUrl}/projects`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        projects += 1;
        if (projects === 1)
          return route.fulfill({
            status: 400,
            json: { error: "Choose a valid Git working folder." },
          });
        await pending;
        return route.continue();
      });
      await page.route(`${harness.baseUrl}/sessions`, (route) => {
        if (route.request().method() === "POST") sessions += 1;
        return route.continue();
      });
      await launch.click();
      await expect(dialog.getByText(/Choose a valid Git working folder\./)).toBeVisible();
      await captureSetup(page, info, width, "rejected-folder");
      await dialog.getByPlaceholder("Taken from the git remote").fill("Launch fixture, reviewed");
      await launch.dblclick();
      await expect(launch).toBeDisabled();
      await captureSetup(page, info, width, "pending-launch");
      expect(projects).toBe(2);
      expect(sessions).toBe(0);
      release();
      await expect(dialog).toHaveCount(0);
      expect(projects).toBe(2);
      if (setupBaseline()) {
        await expect(page).toHaveURL(/\/session\/[^/]+\/insights/);
        expect(sessions).toBe(1);
        return;
      }
      await expect(page).toHaveURL(/#\/\?project=[^&]+$/);
      await expect(homeComposer(page)).toBeFocused();
      expect(sessions).toBe(0);
      expect(await (await request.get(`${harness.baseUrl}/sessions`)).json()).toEqual([]);

      const models = await openModelList(page);
      const search = page.getByRole("textbox", { name: "Search models", exact: true });
      await expect(models.getByRole("menuitemradio", { name: /GPT-5\.6 Terra/ })).toBeVisible();
      await captureSetup(page, info, width, "model-options");
      await search.fill("no such model");
      await expect(models.getByText("No matching models")).toBeVisible();
      await captureSetup(page, info, width, "empty-models");
      await search.fill("Terra");
      await search.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
      await expect(search).toBeVisible();
      await search.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: /^Model: .*Terra/ })).toBeVisible();
      const snapshot = await page.locator("body").ariaSnapshot();
      await info.attach("screen-reader-semantics.txt", {
        body: snapshot,
        contentType: "text/plain",
      });
    }));
}

test("setup controls remain reachable at actual 200 percent tab zoom", async ({
  harness,
  request,
}, info) =>
  withSetupBaselines(async (baseline) => {
    test.setTimeout(90_000);
    const { context, page, zoom } = await openNameZoom(
      info,
      harness.baseUrl,
      undefined,
      undefined,
      (preparedContext) => baseline.beforeContextClose(preparedContext),
    );
    await baseline.withContext(context, async () => {
      await baseline.serve(page, harness.baseUrl);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 });
        await installSetupFixture(page, request, harness, width);
        await page.goto(harness.baseUrl);
        await page.getByRole("button", { name: "Get Started", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "New Project", exact: true });
        const launch = dialog.getByRole("button", { name: "Create Project", exact: true });
        await dialog.getByRole("button", { name: "Select a model", exact: true }).click();
        await page.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
        await expect(launch).toBeEnabled();
        await expect(launch).toBeInViewport();
        if (!setupBaseline()) {
          const rect = await dialog.boundingBox();
          const inner = await page.evaluate(
            () => (globalThis as unknown as { innerWidth: number }).innerWidth,
          );
          expect(rect!.x + rect!.width).toBeLessThanOrEqual(inner + 1);
        }
        await captureSetup(
          page,
          info,
          width,
          "zoom200-default",
          dialog.getByText(setupBaseline() ? "Environment" : "Location", { exact: true }),
        );
        await dialog.getByRole("button", { name: /Working Folder/ }).click();
        const picker = page.getByRole("dialog", {
          name: setupBaseline() ? "Select Working Folder" : "Choose a folder",
          exact: true,
        });
        await expect(picker).toBeVisible();
        await captureSetup(page, info, width, "zoom200-path-selector");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
      }
      await info.attach("actual-browser-zoom.json", {
        body: JSON.stringify({
          zoom,
          method: "chrome.tabs.setZoom/getZoom",
          reducedMotion: "reduce",
          productTheme: "dark",
        }),
        contentType: "application/json",
      });
    });
  }));
