import type { Locator, Page } from "@playwright/test";
import { appModifier, expect } from "./harness";

/**
 * Opens the command palette and returns its dialog: the visible "Search" entry
 * (sidebar, phone header) when there is one, else ⌘K / Ctrl+K. An embedded
 * presentation owns only focused shortcuts, so the button is the portable path.
 */
export async function openCommandPalette(page: Page): Promise<Locator> {
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  const field = palette.getByRole("combobox", { name: "Search commands" });
  const search = page.getByRole("button", { name: "Search", exact: true });
  // A freshly loaded page may not have bound its shortcut yet: retry the entry.
  await expect(async () => {
    if (await palette.isVisible()) return;
    if (await search.isVisible()) {
      await search.click({ timeout: 1_000 });
    } else {
      // An embedded presentation's shortcuts belong to the view holding focus.
      await page.evaluate(() => {
        const { document } = globalThis as unknown as {
          document: {
            activeElement: unknown;
            querySelector(selector: string): {
              contains(node: unknown): boolean;
              querySelector(selector: string): { focus(): void } | null;
            } | null;
          };
        };
        const content = document.querySelector("[data-nac-content]");
        if (content && !content.contains(document.activeElement))
          content.querySelector("textarea, input, button")?.focus();
      });
      await page.keyboard.press(`${await appModifier(page)}+k`);
    }
    await expect(field).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(field).toBeFocused();
  return palette;
}

/** Picks one exact palette command, as a user typing and choosing it would. */
export async function runPaletteCommand(page: Page, label: string): Promise<void> {
  const palette = await openCommandPalette(page);
  const field = palette.getByRole("combobox", { name: "Search commands" });
  await field.fill(label);
  const option = palette
    .getByRole("listbox", { name: "Commands" })
    .getByRole("option", { name: label, exact: true });
  // Keyboard choice: the exact match must be the active option, then Enter picks it.
  await expect(option).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(palette).toHaveCount(0);
}

/** The Settings page's section content (`#/settings/<section>`), by its section label. */
export function settingsSection(page: Page, label: string): Locator {
  return page.getByRole("main", { name: label, exact: true });
}

/** Settings › <label> through the palette; returns the section once rendered. */
export async function openSettingsSection(page: Page, label: string): Promise<Locator> {
  await runPaletteCommand(page, label);
  const section = settingsSection(page, label);
  await expect(section).toBeVisible();
  return section;
}

/**
 * Settings › Capabilities for the session on screen (the palette scopes it with
 * `?session=`). Returns the section once the runtime facts are read.
 */
export async function openCapabilities(page: Page): Promise<Locator> {
  const section = await openSettingsSection(page, "Capabilities");
  await expect(section.getByText("installed-runtime", { exact: true })).toBeVisible();
  return section;
}

/** Settings' "Back" (desktop) / "Settings" then "Back" (push navigation below 1024px). */
export async function leaveSettings(page: Page): Promise<void> {
  const settingsBack = page.getByRole("button", { name: "Settings", exact: true });
  if (await settingsBack.isVisible()) await settingsBack.click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
}

/** Opens the session header's ⋯ menu (desktop) or panel sheet (phone). */
export async function openSessionMenu(page: Page | Locator): Promise<Locator> {
  const phone = page.getByRole("button", { name: "Open panel", exact: true });
  const desktop = page.getByRole("button", { name: "Session menu", exact: true });
  // Wait for the header to render before choosing which trigger this width draws.
  await expect(phone.or(desktop).first()).toBeVisible();
  const trigger = (await phone.isVisible()) ? phone : desktop;
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Session", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/** Session settings dialog through the session header menu. */
export async function openSessionSettings(page: Page): Promise<Locator> {
  const menu = await openSessionMenu(page);
  await menu.getByRole("button", { name: "Session settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Session settings", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the revision-checked title form from the current session's menu. */
export async function openSessionRename(scope: Page | Locator): Promise<Locator> {
  const menu = await openSessionMenu(scope);
  await menu.getByRole("button", { name: "Rename", exact: true }).click();
  const dialog = scope.getByRole("dialog", { name: "Rename session", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
