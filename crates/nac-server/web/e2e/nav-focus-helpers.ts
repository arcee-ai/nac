import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Navigation-area helpers for the Focus shell. Phones have no persistent
 * sidebar: a session's header goes back Home, and Home's header opens the
 * navigation sheet ("Menu") and Search (the command palette).
 */

/** Opens the phone navigation sheet from any route, returning the dialog. */
export async function openPhoneMenu(page: Page): Promise<Locator> {
  const open = page.getByRole("button", { name: "Open the menu", exact: true });
  if (!(await open.isVisible())) {
    await page.getByRole("button", { name: "Home", exact: true }).click();
  }
  await open.click();
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/** Shows the desktop sidebar when it is collapsed (narrow widths start hidden). */
export async function showSidebar(page: Page): Promise<Locator> {
  const expand = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await expand.isVisible()) await expand.click();
  const sidebar = page.locator('[data-sidebar="true"]');
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  return sidebar;
}

/** Opens the ⌘K palette from the visible Search control and filters it. */
export async function searchPalette(
  page: Page,
  query: string,
  from: Locator = page.getByRole("button", { name: "Search", exact: true }).first(),
): Promise<Locator> {
  await from.click();
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search commands", exact: true }).fill(query);
  return palette;
}

/**
 * Opens one of a session's panels as the drawer (desktop) or sheet (phone).
 * Phones list every panel in the "Open panel" sheet; desktop uses the
 * session menu, whose Panels section only exists on phones, so callers that
 * need a desktop panel should prefer its header pill or route.
 */
export async function openPhonePanel(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: "Open panel", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Session", exact: true });
  await sheet
    .getByRole("button")
    .filter({ hasText: new RegExp(`^${label}`) })
    .first()
    .click();
  const panel = page.getByRole("dialog", { name: label, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** Escapes a literal for use inside a RegExp source. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Opens the session's settings dialog from the header: the ⋯ "Session menu"
 * popover on wider screens, the single "Open panel" sheet on phones.
 */
export async function openSessionSettings(page: Page, root: Page | Locator = page): Promise<void> {
  const phone = await page.evaluate(
    () =>
      (globalThis as unknown as { matchMedia(query: string): { matches: boolean } }).matchMedia(
        "(max-width: 767.98px)",
      ).matches,
  );
  await root
    .getByRole("button", { name: phone ? "Open panel" : "Session menu", exact: true })
    .click();
  await root
    .getByRole("dialog", { name: "Session", exact: true })
    .getByRole("button", { name: "Session settings", exact: true })
    .click();
}

async function isPhoneWidth(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (globalThis as unknown as { matchMedia(query: string): { matches: boolean } }).matchMedia(
        "(max-width: 767.98px)",
      ).matches,
  );
}

/**
 * Opens a session panel by its label ("Insights", "Subagents", "Files"…) and
 * returns its drawer (desktop) or sheet (phone). Desktop uses the header pill
 * that names the panel ("Subagents: 1 agent") or the session menu's entry.
 */
export async function openSessionPanel(page: Page, label: string): Promise<Locator> {
  if (await isPhoneWidth(page)) return openPhonePanel(page, label);
  const panel = page.getByRole("dialog", { name: label, exact: true });
  if (await panel.isVisible()) return panel;
  if (label === "Insights") {
    await page.getByRole("button", { name: "Session menu", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Session", exact: true })
      .getByRole("button", { name: "Insights", exact: true })
      .click();
  } else {
    // Pills render once their data lands.
    await page
      .getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}:`) })
      .first()
      .click();
  }
  await expect(panel).toBeVisible();
  return panel;
}
