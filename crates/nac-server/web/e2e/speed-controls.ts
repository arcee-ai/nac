import type { Page } from "@playwright/test";

export function modelChip(page: Page) {
  return page.getByRole("button", { name: /^(Model: |Choose a model$)/ });
}

export async function openModelSettings(page: Page) {
  const settings = page.getByRole("dialog", { name: "Model settings", exact: true });
  if (!(await settings.isVisible())) await modelChip(page).click();
  return settings;
}

export async function openModelCatalog(page: Page, filter: string) {
  const settings = await openModelSettings(page);
  await settings.getByRole("button", { name: /^Choose model(?:$|:)/ }).click();
  await settings.getByRole("textbox", { name: "Search models" }).fill(filter);
  return settings.getByRole("menu", { name: "Model", exact: true });
}
