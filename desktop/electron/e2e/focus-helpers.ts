import type { Page } from '@playwright/test';
import { expect } from './fixture';

/** Exercise the production Session menu/drawer from the actual Electron page. */
export async function showSessionPanel(page: Page, label: string) {
  const tabs = page.getByRole('tablist', { name: 'Session panels', exact: true });
  if (!(await tabs.isVisible())) {
    await page.getByRole('button', { name: 'Session menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Session', exact: true })
      .getByRole('button', { name: /^Insights(?:\s|$)/ }).click();
  }
  const tab = tabs.getByRole('tab', { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tabs.evaluate(element => {
    const surface = element.closest('[role="dialog"], aside') ?? element;
    const rect = surface.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && surface.getAnimations().every(animation => animation.playState !== 'running');
  })).toBe(true);
}

/** Open the current shared Settings section through the palette's real UI. */
export async function openSettingsSection(page: Page, label: string) {
  const section = page.getByRole('main', { name: label, exact: true });
  if (!(await section.isVisible())) {
    const search = page.getByRole('button', { name: 'Search', exact: true });
    if (await search.isVisible()) await search.click();
    else {
      await page.getByRole('heading').first().click();
      await page.keyboard.press('Meta+k');
    }
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await palette.getByRole('combobox', { name: 'Search commands', exact: true }).fill(label);
    await palette.getByRole('option', { name: label, exact: true }).click();
  }
  await expect(section).toBeVisible();
  return section;
}
