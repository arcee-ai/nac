import type { Locator, Page } from "@playwright/test";
import { openModelList } from "./focus-embedded-helpers";

/** Select the fixture provider for an explicitly modeled new session or task. */
export async function chooseFixtureSessionModel(page: Page, form: Locator) {
  await form.getByRole("group", { name: "Model*", exact: true }).getByRole("button").click();
  await page.getByRole("textbox", { name: "Search models" }).fill("gpt-5.6-sol");
  await page
    .locator('[aria-label="Model results"] button[data-row]')
    .filter({ hasText: /gpt-5\.6/i })
    .locator("..")
    .filter({ has: page.getByText("OpenAI", { exact: true }) })
    .locator("button[data-row]")
    .first()
    .click();
}

/** Select the fixture model from Home's composer and close its picker. */
export async function chooseFixtureComposerModel(page: Page) {
  const list = await openModelList(page);
  await page.getByRole("textbox", { name: "Search models" }).fill("gpt-5.6-sol");
  await list
    .getByRole("group", { name: "OpenAI", exact: true })
    .getByRole("menuitemradio", { name: /gpt-5\.6/i })
    .click();
  await page.keyboard.press("Escape");
}
