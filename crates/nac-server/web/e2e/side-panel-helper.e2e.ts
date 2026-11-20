import { expect, test, type Page } from "@playwright/test";
import { showSidePanel } from "./harness";

// Exercise the header toggle with real locator actionability and late hydration.
async function closedPanel(page: Page, { opens = true, width = 1000 } = {}) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(`
    <button id="toggle" aria-label="Session panel" aria-pressed="false" onclick="
      document.querySelector('#panel-clicks').textContent++;
      ${opens ? "this.setAttribute('aria-pressed', 'true'); document.querySelector('#panels').hidden = false;" : ""}
    ">Panels</button>
    <div id="panels" role="tablist" aria-label="Session panels" hidden>
      <button role="tab" aria-selected="true">Insights</button>
    </div>
    <div data-testid="hydrate" hidden>Restore saved panel</div>
    <output id="panel-clicks">0</output>
  `);
}

// Insert a deterministic hydration barrier immediately before the real click.
// Visibility/expectations and the click itself still use Playwright's locators.
function beforePanelClick(page: Page, before: () => Promise<void>) {
  const getByRole = page.getByRole.bind(page);
  page.getByRole = (role, options) => {
    const locator = getByRole(role, options);
    if (role === "button" && options?.name === "Session panel") {
      const click = locator.click.bind(locator);
      locator.click = async (options) => {
        await before();
        return click(options);
      };
    }
    return locator;
  };
}

const panels = (page: Page) => page.getByRole("tablist", { name: "Session panels" });

test("showSidePanel reobserves saved-open hydration before the header toggle is clicked", async ({
  page,
}) => {
  test.setTimeout(8_000);
  await closedPanel(page);
  await page.addLocatorHandler(
    page.getByTestId("hydrate"),
    async () => {
      await page
        .locator("#toggle")
        .evaluate((element) => element.setAttribute("aria-pressed", "true"));
      await page.locator("#panels").evaluate((element) => element.removeAttribute("hidden"));
      await page.getByTestId("hydrate").evaluate((element) => element.setAttribute("hidden", ""));
    },
    { times: 1, noWaitAfter: true },
  );
  beforePanelClick(page, async () => {
    await page.getByTestId("hydrate").evaluate((element) => element.removeAttribute("hidden"));
  });

  await showSidePanel(page);

  await expect(panels(page)).toBeVisible();
  await expect(page.locator("#panel-clicks")).toHaveText("0");
});

test("showSidePanel opens a closed drawer with one ordinary click", async ({ page }) => {
  await closedPanel(page);
  await showSidePanel(page);
  await expect(panels(page)).toBeVisible();
  await expect(page.locator("#panel-clicks")).toHaveText("1");
});

for (const width of [1000, 1440]) {
  test(`showSidePanel leaves an already-open drawer alone at ${width}px`, async ({ page }) => {
    await closedPanel(page, { width });
    await page.locator("#panels").evaluate((element) => element.removeAttribute("hidden"));
    await showSidePanel(page);
    await expect(page.locator("#panel-clicks")).toHaveText("0");
  });
}

test("showSidePanel rejects when a real click never opens the drawer", async ({ page }) => {
  test.setTimeout(10_000);
  await closedPanel(page, { opens: false });
  await expect(showSidePanel(page)).rejects.toThrow(/timeout/i);
  expect(Number(await page.locator("#panel-clicks").textContent())).toBeGreaterThanOrEqual(1);
  await expect(panels(page)).toBeHidden();
});

test("showSidePanel preserves disabled-action diagnostics", async ({ page }) => {
  test.setTimeout(10_000);
  await closedPanel(page);
  await page.locator("#toggle").evaluate((element) => element.setAttribute("disabled", ""));
  await expect(showSidePanel(page)).rejects.toThrow(/not enabled/);
});

test("showSidePanel preserves a closed-page action error", async ({ page }) => {
  test.setTimeout(6_000);
  await closedPanel(page);
  beforePanelClick(page, () => page.close());
  await expect(showSidePanel(page)).rejects.toThrow(/closed/);
});
