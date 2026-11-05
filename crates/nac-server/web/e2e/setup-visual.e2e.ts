import { expect, test } from "./harness";
import {
  captureSetup,
  installSetupFixture,
  longModel,
  withSetupBaselines,
  setupBaseline,
} from "./setup-visual-fixture";
import { openNameZoom } from "./session-name-zoom";

test.use({ orchestration: "0", hasTouch: true });
test.skip(!!process.env.NAC_E2E_REMOTE, "Requires disposable local setup commands");

for (const width of [1440, 768, 390]) {
  test(`project launch form, nested choices and settled commands at ${width}px`, async ({
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
      const model = dialog.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first();
      const launch = dialog.getByRole("button", { name: "Create Project", exact: true });
      await expect(
        dialog.getByRole("button", { name: "Loading models…", exact: true }),
      ).toBeDisabled();
      await captureSetup(page, info, width, "loading-models");
      releaseCatalog();
      await expect(
        dialog.getByRole("button", { name: "Select a model", exact: true }),
      ).toBeVisible();
      await captureSetup(page, info, width, "default");
      await info.attach("setup-accessibility-semantics.txt", {
        body: await dialog.ariaSnapshot(),
        contentType: "text/plain",
      });
      if (!setupBaseline()) {
        await expect(dialog.getByRole("region", { name: "Environment" })).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "Project name" })).toBeVisible();
      }
      await dialog.getByRole("button", { name: "Select a model", exact: true }).click();
      await page.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
      await expect(model).toBeVisible();
      await expect(launch).toBeEnabled();
      await dialog.getByPlaceholder("Taken from the git remote").fill("Launch fixture");
      if (width === 390) await model.tap();
      else await model.click();
      const search = page.getByPlaceholder("Search models…");
      await expect(page.getByRole("button").filter({ hasText: longModel })).toBeVisible();
      await captureSetup(page, info, width, "model-options");
      await search.fill("no such model");
      await expect(page.getByText('No model matches "no such model".')).toBeVisible();
      await captureSetup(page, info, width, "empty-models");
      await search.fill("Terra");
      if (!setupBaseline()) {
        await search.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
        await expect(search).toBeVisible();
      }
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(dialog.getByRole("button").filter({ hasText: longModel }).first()).toBeVisible();
      await dialog
        .getByRole("button", { name: "Advanced presets and provider setup", exact: true })
        .click();
      await expect(dialog.getByRole("button", { name: "Create New", exact: true })).toBeVisible();
      await captureSetup(
        page,
        info,
        width,
        "advanced",
        dialog.getByText("Configurations", { exact: true }),
      );
      await dialog.getByRole("button", { name: "Back to unified models", exact: true }).click();
      const folderButton = dialog
        .getByRole("button", { name: new RegExp(`Working Folder|${folder}`) })
        .first();
      await folderButton.click();
      const picker = page.getByRole("dialog", { name: "Select Working Folder", exact: true });
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
      await dialog.getByRole("button", { name: "Select a model", exact: true }).click();
      await page.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
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
      await expect(page).toHaveURL(/\/session\/[^/]+\/insights/);
      expect(projects).toBe(2);
      expect(sessions).toBe(1);
      const stored = (await (await request.get(`${harness.baseUrl}/sessions`)).json())[0];
      const config = await (
        await request.get(`${harness.baseUrl}/sessions/${stored.summary.session_id}/config`)
      ).json();
      expect(config).toMatchObject({ model: "gpt-5.6-sol", backend: "openai-responses" });
      if (!setupBaseline()) {
        const snapshot = await page.locator("body").ariaSnapshot();
        await info.attach("screen-reader-semantics.txt", {
          body: snapshot,
          contentType: "text/plain",
        });
      }
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
          dialog.getByText("Environment", { exact: true }),
        );
        await dialog.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
        await expect(page.getByPlaceholder("Search models…")).toBeVisible();
        await captureSetup(page, info, width, "zoom200-models");
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
