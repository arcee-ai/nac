import { expect, test, type Page } from "@playwright/test";
import { showSidePanel } from "./harness";

// Exercise the helper against real locator actionability without starting NAC.
async function closedPanel(page: Page, opens = true) {
  await page.setContent(`
    <button id="show" aria-label="Show panel" onclick="
      document.querySelector('#clicks').textContent++;
      ${opens ? "this.remove(); document.querySelector('#files').hidden = false;" : ""}
    ">Show panel</button>
    <button id="files" role="tab" hidden>Files</button>
    <div data-testid="hydrate" hidden>Restore saved panel</div>
    <output id="clicks">0</output>
  `);
}

// Insert a deterministic hydration barrier immediately before the real click.
// Visibility/expectations and the click itself still use Playwright's locators.
function beforeShowClick(page: Page, before: () => Promise<void>) {
  const getByRole = page.getByRole.bind(page);
  page.getByRole = (role, options) => {
    const locator = getByRole(role, options);
    if (role === "button" && options?.name === "Show panel") {
      const click = locator.click.bind(locator);
      locator.click = async (options) => {
        await before();
        return click(options);
      };
    }
    return locator;
  };
}

test("showSidePanel reobserves saved-open hydration after Show panel detaches", async ({
  page,
}) => {
  test.setTimeout(8_000);
  await closedPanel(page);
  await page.addLocatorHandler(
    page.getByTestId("hydrate"),
    async () => {
      await page.locator("#show").evaluate((element) => element.remove());
      await page.locator("#files").evaluate((element) => element.removeAttribute("hidden"));
      await page.getByTestId("hydrate").evaluate((element) => element.setAttribute("hidden", ""));
    },
    { times: 1, noWaitAfter: true },
  );
  beforeShowClick(page, async () => {
    await page.getByTestId("hydrate").evaluate((element) => element.removeAttribute("hidden"));
  });

  await showSidePanel(page);

  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.locator("#clicks")).toHaveText("0");
});

test("showSidePanel opens a closed panel with one ordinary click", async ({ page }) => {
  await closedPanel(page);
  await showSidePanel(page);
  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.locator("#clicks")).toHaveText("1");
});

test("showSidePanel leaves an already-open panel alone", async ({ page }) => {
  await closedPanel(page);
  await page.locator("#files").evaluate((element) => element.removeAttribute("hidden"));
  await showSidePanel(page);
  await expect(page.locator("#clicks")).toHaveText("0");
});

test("showSidePanel rejects when a real click never opens the panel", async ({ page }) => {
  test.setTimeout(6_000);
  await closedPanel(page, false);
  await expect(showSidePanel(page)).rejects.toThrow(/timeout/i);
  await expect(page.locator("#clicks")).toHaveText("1");
  await expect(page.getByRole("tab", { name: "Files" })).toBeHidden();
});

test("showSidePanel preserves disabled-action diagnostics", async ({ page }) => {
  test.setTimeout(6_000);
  await closedPanel(page);
  await page.locator("#show").evaluate((element) => element.setAttribute("disabled", ""));
  await expect(showSidePanel(page)).rejects.toThrow(/not enabled/);
});

test("showSidePanel preserves a closed-page action error", async ({ page }) => {
  test.setTimeout(6_000);
  await closedPanel(page);
  beforeShowClick(page, () => page.close());
  await expect(showSidePanel(page)).rejects.toThrow(/closed/);
});
