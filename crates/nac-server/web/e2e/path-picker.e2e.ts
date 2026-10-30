import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./harness";

test.use({ orchestration: "0" });

test("Select applies the typed working folder without pressing Enter", async ({
  harness,
  page,
}, testInfo) => {
  // The harness gives the server its own HOME, so `~/` stays inside this run.
  const spaced = path.join(harness.runRoot, "picked folders", "café ü 项目");
  const homeRelative = path.join(harness.runRoot, "home", "dev projects", "nac ü");
  await fs.mkdir(spaced, { recursive: true });
  await fs.mkdir(homeRelative, { recursive: true });
  // The server canonicalizes, so the temp directory's symlinks resolve.
  const spacedCanonical = await fs.realpath(spaced);
  const homeRelativeCanonical = await fs.realpath(homeRelative);
  const workspaceCanonical = await fs.realpath(path.join(harness.runRoot, "workspace"));

  await page.goto(harness.baseUrl);
  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New Project" });
  const folderButton = form.getByRole("button", { name: /workspace|picked folders|nac ü/ });
  await expect(folderButton).toHaveText(workspaceCanonical);
  const picker = page.getByRole("dialog", { name: "Select Working Folder" });
  const draft = picker.getByPlaceholder("/path/to/directory");
  const select = picker.getByRole("button", { name: "Select", exact: true });

  // An absolute path with spaces and Unicode, typed and selected directly.
  await folderButton.click();
  await expect(picker).toBeVisible();
  await draft.fill(spaced);
  await select.click();
  await expect(picker).toBeHidden();
  await form.screenshot({ path: testInfo.outputPath("typed-path-select.png") });
  await expect(folderButton).toHaveText(spacedCanonical);

  // A home-relative path resolves on the server, not in the browser.
  await folderButton.click();
  await draft.fill("~/dev projects/nac ü");
  await select.click();
  await expect(picker).toBeHidden();
  await expect(folderButton).toHaveText(homeRelativeCanonical);

  // A folder that does not exist is reported and never created.
  const missing = path.join(harness.runRoot, "no such folder");
  await folderButton.click();
  await draft.fill(missing);
  await select.click();
  const alert = picker.getByRole("alert");
  await expect(alert).toContainText(`Cannot select this folder: path '${missing}' does not exist`);
  await expect(picker).toBeVisible();
  await expect(draft).toHaveValue(missing);
  await picker.screenshot({ path: testInfo.outputPath("missing-path-select.png") });
  await expect(fs.access(missing)).rejects.toThrow();

  // Cancel leaves the form with the folder it already had.
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(folderButton).toHaveText(homeRelativeCanonical);
});
