import fs from "node:fs/promises";
import { expect, test } from "./harness";
import { openModelList } from "./focus-embedded-helpers";
import { openNameZoom } from "./session-name-zoom";
import { installSetupFixture, longModel } from "./setup-visual-fixture";

test.use({ orchestration: "0", hasTouch: true });
test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated local form fixture");

for (const zoomed of [false, true]) {
  test(`project and account forms remain usable at ${zoomed ? "real200percent195CSS" : "390CSS"}`, async ({
    harness,
    page: defaultPage,
    request,
  }, info) => {
    test.setTimeout(90_000);
    const zoom = zoomed ? await openNameZoom(info, harness.baseUrl) : null;
    const page = zoom?.page ?? defaultPage;
    try {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await installSetupFixture(page, request, harness, 390);
      await page.goto(harness.baseUrl);
      const viewport = await page
        .locator("html")
        .evaluate((node) => node.ownerDocument.defaultView!.innerWidth);
      expect(viewport).toBe(zoomed ? 195 : 390);
      await page.getByRole("button", { name: "Get Started", exact: true }).click();
      const project = page.getByRole("dialog", { name: "New Project", exact: true });
      const name = project.getByRole("textbox", { name: "Project name", exact: true });
      await name.fill("Project setup at constrained width");
      const submit = project.getByRole("button", { name: "Create Project", exact: true });
      await expect(submit).toBeInViewport();
      let rejectProject = true;
      const projectBodies: unknown[] = [];
      await page.route(`${harness.baseUrl}/projects`, (route) => {
        if (route.request().method() !== "POST") return route.continue();
        projectBodies.push(route.request().postDataJSON());
        if (!rejectProject) return route.continue();
        return route.fulfill({
          status: 400,
          json: { error: "Controlled project validation failed." },
        });
      });
      await submit.click();
      const projectError = project.getByRole("alert");
      await expect(projectError).toBeInViewport();
      await expect(projectError).not.toBeEmpty();
      await expect(name).toHaveValue("Project setup at constrained width");
      await expect(submit).toBeDisabled();
      await name.fill("Reviewed project draft");
      rejectProject = false;
      await submit.click();
      await expect(project).toHaveCount(0);
      await expect(page).toHaveURL(/#\/\?project=[^&]+$/);
      expect(projectBodies).toHaveLength(2);

      const models = await openModelList(page);
      await page.getByRole("textbox", { name: "Search models" }).fill("Terra");
      const longOption = models.getByRole("menuitemradio", { name: /GPT-5\.6 Terra/ });
      await expect(longOption).toHaveAccessibleName(new RegExp(longModel.split(" — ")[0]));
      await longOption.click();
      const chip = page.getByRole("button", { name: /^Model: .*Terra/ });
      await expect(chip).toHaveAccessibleName(/careful review/);
      const chipBox = await chip.boundingBox();
      expect(chipBox).not.toBeNull();
      expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(viewport + 1);

      // Accounts uses the real catalog and credential store. The first PUT is
      // rejected at the boundary; only the user's next submit may persist it.
      await page.unroute(`${harness.baseUrl}/models`);
      let writes = 0;
      const credentialUrl = `${harness.baseUrl}/credentials/FIREWORKS_API_KEY`;
      await page.route(credentialUrl, (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        writes += 1;
        if (writes === 1)
          return route.fulfill({ status: 422, json: { error: "Fixture rejection" } });
        return route.continue();
      });
      await page.goto(`${harness.baseUrl}/#/settings/accounts`);
      await page.getByRole("button", { name: "Add Fireworks key" }).click();
      const key = page.getByLabel("Fireworks API key");
      await expect(key).toBeFocused();
      await expect(key).toHaveAttribute("type", "password");
      const save = page.getByRole("button", { name: "Save key", exact: true });
      await expect(save).toBeDisabled();
      const fixtureKey = "nac-e2e-only-fireworks-7459";
      await key.fill(fixtureKey);
      await save.click();
      const keyError = page.getByRole("alert").filter({ hasText: "Could not save the key" });
      await expect(keyError).toBeVisible();
      await expect(key).toHaveValue(fixtureKey);
      await save.click();
      await expect(page.getByText("Key ending in 7459", { exact: true })).toBeVisible();
      await expect(key).toHaveCount(0);
      await expect(page.getByText(fixtureKey, { exact: true })).toHaveCount(0);
      expect(writes).toBe(2);
      const credentials = await (await request.get(`${harness.baseUrl}/credentials`)).text();
      expect(credentials).toContain("FIREWORKS_API_KEY");
      expect(credentials).not.toContain(fixtureKey);

      const file = info.outputPath("reviewed-form-regressions.json");
      await fs.writeFile(
        file,
        JSON.stringify({ viewport, projectBodies, chipBox, writes }, null, 2),
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
