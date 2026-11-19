import type { Locator, Page } from "@playwright/test";

/** Select the fixture provider for an explicitly modeled new session or task. */
export async function chooseFixtureSessionModel(page: Page, form: Locator) {
  await form.getByRole("group", { name: "Model*", exact: true }).getByRole("button").click();
  await page.getByRole("textbox", { name: "Search models" }).fill("gpt-5.6-sol");
  await page
    .locator('[aria-label="Model results"] button[data-row]')
    .filter({ hasText: /gpt-5\.6/i })
    .locator("..")
    .filter({ hasText: "OpenAI Responses" })
    .locator("button[data-row]")
    .first()
    .click();
}
