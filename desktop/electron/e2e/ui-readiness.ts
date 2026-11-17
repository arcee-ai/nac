import { expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";

export async function prepareNewShell(pane: Locator): Promise<void> {
  const launch = pane.getByRole("button", { name: /^New shell$/i });
  const openList = pane.getByRole("button", { name: "Open list", exact: true });
  // Follow the shared compact-panel navigation, as terminal-local-acceptance
  // does in the browser lane. This never creates or retries a shell itself.
  await expect(launch.or(openList)).toBeVisible();
  if (!(await launch.isVisible())) await openList.click();
  await expect(launch).toBeVisible();
  await expect(launch).toBeEnabled();
}

export async function workspacePage(app: ElectronApplication, endpoint: string): Promise<Page> {
  let committed: Page | undefined;
  // A new window or recovery.pending=false may precede loadURL committing.
  // Bind the page to the already-verified receipt, never to a status window.
  await expect
    .poll(() => {
      const pages = app
        .windows()
        .filter((page) => !page.isClosed() && page.url().startsWith(endpoint + "/"));
      committed = pages.length === 1 ? pages[0] : undefined;
      return !!committed;
    })
    .toBe(true);
  return committed!;
}
