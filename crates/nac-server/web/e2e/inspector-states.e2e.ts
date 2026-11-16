import { createDirectSession, expect, showSidePanel, test } from "./harness";
import {
  captureInspector,
  serveInspectorVersion,
  type InspectorVersion,
} from "./inspector-evidence";

test("captures matched inspector loading, error and empty states", async ({
  harness,
  context,
  request,
}) => {
  test.setTimeout(120_000);
  test.skip(!process.env.NAC_INSPECTOR_CAPTURE_DIR, "Explicit evidence capture only");
  const parent = await createDirectSession(request, harness);
  const versions: InspectorVersion[] = process.env.NAC_INSPECTOR_BASELINE_DIST
    ? ["before", "after"]
    : ["after"];
  for (const version of versions) {
    for (const width of [1440, 768, 390]) {
      const page = await context.newPage();
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let fail = true;
      try {
        await serveInspectorVersion(page, harness.baseUrl, version);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.route(`**/sessions/${parent}/children`, async (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          await waiting;
          if (fail) return route.fulfill({ status: 503, body: "unavailable" });
          return route.fallback();
        });
        await page.goto(`${harness.baseUrl}/#/session/${parent}/delegated`);
        if (width < 768)
          await page.getByRole("button", { name: "Open panel", exact: true }).click();
        else {
          await showSidePanel(page);
          if (width < 1280)
            await page.getByRole("button", { name: "Open list", exact: true }).click();
        }
        await expect(page.getByText("Loading subagents…", { exact: true }).first()).toBeVisible();
        await captureInspector(page, `${version}-${width}-subagents-loading`);
        release();
        const alert = page.getByRole("alert").filter({ hasText: "Subagents could not be loaded" });
        await expect(alert.first()).toBeVisible();
        await captureInspector(page, `${version}-${width}-subagents-error`);
        fail = false;
        await alert.first().getByRole("button", { name: "Try again", exact: true }).click();
        await expect(page.getByText("No subagents yet", { exact: true })).toBeVisible();
        await expect(alert).toHaveCount(0);
        await captureInspector(page, `${version}-${width}-subagents-empty`);
        await page.getByRole("tab", { name: "Insights", exact: true }).click();
        await expect(page.getByText("No insights yet", { exact: true })).toBeVisible();
        await captureInspector(page, `${version}-${width}-insights-no-selection`);
      } finally {
        release();
        await page.close();
      }
    }
  }
  expect(harness.provider.requests).toHaveLength(0);
});
