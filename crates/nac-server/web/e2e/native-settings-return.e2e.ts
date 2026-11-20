import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProject, createSession, expect, test } from "./harness";
import { openSettingsSection } from "./settings-focus";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = await fs.readFile(
  path.join(repository, "desktop/macos/NativeCommandSmoke.swift"),
  "utf8",
);
const script = source.match(/static let settingsBackScript = #"""([\s\S]*?)"""#/);
if (!script) throw new Error("Missing actual native Settings return fixture");
const back = new Function("label", script[1]!) as (label: string) => boolean;

for (const width of [1440, 1024, 920, 390]) {
  test(`actual native Settings return script preserves the session at ${width}px`, async ({
    harness,
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const project = await createProject(request, harness);
    const session = await createSession(request, harness, "direct", project);
    await page.goto(`${harness.baseUrl}/#/session/${session}/insights`);
    const composer = page.getByRole("combobox", { name: "Message", exact: true });
    await composer.fill("Keep the exact native return draft");
    await openSettingsSection(page, "Accounts & keys");
    await expect(
      page.getByRole("button", { name: width < 1024 ? "Settings" : "Back", exact: true }),
    ).toBeVisible();
    const compact = await page.evaluate(back, "Settings");
    expect(compact).toBe(width < 1024);
    if (compact) {
      await expect(page).toHaveURL(/#\/settings$/);
      await expect(
        page.getByRole("navigation", { name: "Settings sections", exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    expect(await page.evaluate(back, "Back")).toBe(true);
    await expect(page).toHaveURL(`${harness.baseUrl}/#/session/${session}/insights`);
    await expect(composer).toHaveValue("Keep the exact native return draft");
    await expect(composer).toBeFocused();
    harness.provider.assertConsumed();
  });
}
