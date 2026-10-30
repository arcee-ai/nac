import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./harness";

test.use({ orchestration: "0" });

test("New folder creates one folder that Select then applies", async ({
  harness,
  page,
}, testInfo) => {
  const parent = path.join(harness.runRoot, "new projects");
  await fs.mkdir(path.join(parent, "taken"), { recursive: true });
  await fs.writeFile(path.join(parent, "taken", "keep.txt"), "kept");
  // The server canonicalizes, so the temp directory's symlinks resolve.
  const parentCanonical = await fs.realpath(parent);
  const created = path.join(parentCanonical, "café ü 项目");
  const workspaceCanonical = await fs.realpath(path.join(harness.runRoot, "workspace"));

  await page.goto(harness.baseUrl);
  await page.getByRole("button", { name: "New Project", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New Project" });
  const folderButton = form.getByRole("button", { name: /workspace|café/ });
  await expect(folderButton).toHaveText(workspaceCanonical);
  const picker = page.getByRole("dialog", { name: "Select Working Folder" });
  const draft = picker.getByPlaceholder("/path/to/directory");
  const newFolder = picker.getByRole("group", { name: "New folder" });
  const nameField = newFolder.getByLabel("New folder name");
  const create = newFolder.getByRole("button", { name: "Create", exact: true });

  await folderButton.click();
  await draft.fill(parentCanonical);
  await draft.press("Enter");
  await expect(picker.getByRole("button", { name: "taken" })).toBeVisible();
  await picker.screenshot({ path: testInfo.outputPath("picker-listing.png") });
  await picker.getByRole("button", { name: "New folder", exact: true }).click();
  await picker.screenshot({ path: testInfo.outputPath("new-folder-form.png") });

  // An invalid name is refused by the server, and nothing is created anywhere.
  await nameField.fill("../escape");
  await create.click();
  await expect(newFolder.getByRole("alert")).toContainText(
    "Could not create “../escape”: a folder name cannot contain '/'",
  );
  await expect(nameField).toHaveValue("../escape");
  await picker.screenshot({ path: testInfo.outputPath("new-folder-invalid.png") });
  await expect(fs.access(path.join(harness.runRoot, "escape"))).rejects.toThrow();

  // An existing name is a conflict, never a replacement.
  await nameField.fill("taken");
  await create.click();
  await expect(newFolder.getByRole("alert")).toContainText(
    `Could not create “taken”: '${path.join(parentCanonical, "taken")}' already exists`,
  );
  await picker.screenshot({ path: testInfo.outputPath("new-folder-collision.png") });
  expect(await fs.readFile(path.join(parent, "taken", "keep.txt"), "utf8")).toBe("kept");

  // Spaces and Unicode: exactly that folder is made, browsed into and drafted.
  await nameField.fill("café ü 项目");
  await create.click();
  await expect(draft).toHaveValue(created);
  await expect(newFolder).toBeHidden();
  await expect(picker.getByText("No subdirectories here.", { exact: false })).toBeVisible();
  expect((await fs.readdir(parent)).sort()).toEqual(["café ü 项目", "taken"]);
  expect(await fs.readdir(created)).toEqual([]);
  await picker.screenshot({ path: testInfo.outputPath("new-folder-created.png") });
  // Creating is not selecting: the form still has its old folder until Select.
  await expect(folderButton).toHaveText(workspaceCanonical);

  await picker.getByRole("button", { name: "Select", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(folderButton).toHaveText(created);
  await form.screenshot({ path: testInfo.outputPath("new-folder-selected.png") });

  // Typing a path that does not exist still never creates it.
  const typed = path.join(parentCanonical, "typed only");
  await folderButton.click();
  await draft.fill(typed);
  await picker.getByRole("button", { name: "Select", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("does not exist");
  await expect(fs.access(typed)).rejects.toThrow();
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(folderButton).toHaveText(created);
});
