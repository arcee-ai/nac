import { expect, test, type Page } from "@playwright/test";
import { showSidePanel } from "./harness";

// Exercise the helper against real locator actionability without starting NAC.
// The fake mirrors Focus's session chrome: a closed drawer whose tabs are the
// "Session panels" tablist, the header's "Session menu" holding an Insights
// action, and ⌘\ (⌃\ off a Mac) docking the drawer where it fits.
async function closedPanel(page: Page, { opens = true, width = 1000 } = {}) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(`
    <button id="menu" aria-label="Session menu" onclick="
      document.querySelector('#menu-clicks').textContent++;
      const details = document.querySelector('#details');
      details.hidden = !details.hidden;
    ">⋯</button>
    <div id="details" role="dialog" aria-label="Session" hidden>
      <button id="insights" onclick="
        document.querySelector('#insights-clicks').textContent++;
        ${opens ? "document.querySelector('#details').hidden = true; document.querySelector('#panels').hidden = false;" : ""}
      ">Insights</button>
    </div>
    <div id="panels" role="tablist" aria-label="Session panels" hidden>
      <button role="tab" aria-selected="true">Insights</button>
      <button role="tab" aria-selected="false">Files</button>
    </div>
    <div data-testid="hydrate" hidden>Restore saved panel</div>
    <output id="menu-clicks">0</output>
    <output id="insights-clicks">0</output>
    <output id="docks">0</output>
    <script>
      addEventListener("keydown", (event) => {
        if (event.key !== "\\\\" || !(event.ctrlKey || event.metaKey)) return;
        document.querySelector("#docks").textContent++;
        ${opens ? "document.querySelector('#panels').hidden = false;" : ""}
      });
    </script>
  `);
}

// Insert a deterministic hydration barrier immediately before the real click.
// Visibility/expectations and the click itself still use Playwright's locators.
function beforeMenuClick(page: Page, before: () => Promise<void>) {
  const getByRole = page.getByRole.bind(page);
  page.getByRole = (role, options) => {
    const locator = getByRole(role, options);
    if (role === "button" && options?.name === "Session menu") {
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

test("showSidePanel reobserves saved-open hydration after the Session menu detaches", async ({
  page,
}) => {
  test.setTimeout(8_000);
  await closedPanel(page);
  await page.addLocatorHandler(
    page.getByTestId("hydrate"),
    async () => {
      await page.locator("#menu").evaluate((element) => element.remove());
      await page.locator("#panels").evaluate((element) => element.removeAttribute("hidden"));
      await page.getByTestId("hydrate").evaluate((element) => element.setAttribute("hidden", ""));
    },
    { times: 1, noWaitAfter: true },
  );
  beforeMenuClick(page, async () => {
    await page.getByTestId("hydrate").evaluate((element) => element.removeAttribute("hidden"));
  });

  await showSidePanel(page);

  await expect(panels(page)).toBeVisible();
  await expect(page.locator("#menu-clicks")).toHaveText("0");
  await expect(page.locator("#insights-clicks")).toHaveText("0");
});

test("showSidePanel opens a closed drawer through the Session menu with ordinary clicks", async ({
  page,
}) => {
  await closedPanel(page);
  await showSidePanel(page);
  await expect(panels(page)).toBeVisible();
  await expect(page.locator("#menu-clicks")).toHaveText("1");
  await expect(page.locator("#insights-clicks")).toHaveText("1");
  await expect(page.locator("#docks")).toHaveText("0");
});

test("showSidePanel docks a closed drawer with one keystroke where it fits", async ({ page }) => {
  await closedPanel(page, { width: 1440 });
  await showSidePanel(page);
  await expect(panels(page)).toBeVisible();
  await expect(page.locator("#docks")).toHaveText("1");
  await expect(page.locator("#menu-clicks")).toHaveText("0");
});

for (const width of [1000, 1440]) {
  test(`showSidePanel leaves an already-open drawer alone at ${width}px`, async ({ page }) => {
    await closedPanel(page, { width });
    await page.locator("#panels").evaluate((element) => element.removeAttribute("hidden"));
    await showSidePanel(page);
    await expect(page.locator("#menu-clicks")).toHaveText("0");
    await expect(page.locator("#insights-clicks")).toHaveText("0");
    await expect(page.locator("#docks")).toHaveText("0");
  });
}

test("showSidePanel rejects when a real click never opens the drawer", async ({ page }) => {
  test.setTimeout(10_000);
  await closedPanel(page, { opens: false });
  await expect(showSidePanel(page)).rejects.toThrow(/timeout/i);
  // The menu stays open between attempts, so it is never toggled shut again.
  await expect(page.locator("#menu-clicks")).toHaveText("1");
  expect(Number(await page.locator("#insights-clicks").textContent())).toBeGreaterThanOrEqual(1);
  await expect(panels(page)).toBeHidden();
});

test("showSidePanel preserves disabled-action diagnostics", async ({ page }) => {
  test.setTimeout(10_000);
  await closedPanel(page);
  await page.locator("#menu").evaluate((element) => element.setAttribute("disabled", ""));
  await expect(showSidePanel(page)).rejects.toThrow(/not enabled/);
});

test("showSidePanel preserves a closed-page action error", async ({ page }) => {
  test.setTimeout(6_000);
  await closedPanel(page);
  beforeMenuClick(page, () => page.close());
  await expect(showSidePanel(page)).rejects.toThrow(/closed/);
});
