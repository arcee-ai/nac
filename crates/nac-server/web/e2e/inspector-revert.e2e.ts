import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

import { createDirectSession, expect, showSidePanel, test, waitForRunIdle } from "./harness";
import { captureInspector, inspectorPane } from "./inspector-evidence";
import { ScriptGate } from "./scripted-provider";

const execute = promisify(execFile);
async function fileList(page: Page, mobile: boolean) {
  if (mobile) {
    const back = page.getByRole("button", { name: "Open list", exact: true });
    if (await back.isVisible()) await back.click();
  }
}
async function chooseRevision(page: Page, name: RegExp, mobile: boolean) {
  await fileList(page, mobile);
  if (mobile) await page.getByRole("tab", { name: "History", exact: true }).click();
  else await page.getByRole("button", { name: /^Snapshot:/ }).click();
  await page.getByRole("button", { name }).click();
  if (mobile) await page.getByRole("tab", { name: "Files", exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`inspector snapshot revert requires confirmation and restores fixture files once at ${width}px`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const mobile = width < 768;
    const parent = await createDirectSession(request, harness);
    const workspace = path.join(harness.runRoot, "workspace");
    const git = (...args: string[]) => execute("git", ["-C", workspace, ...args]);
    await git("config", "user.name", "Disposable NAC fixture");
    await git("config", "user.email", "nac-fixture@example.test");
    const file = path.join(workspace, "revert-notes.txt");
    await fs.writeFile(file, "REVERT_ALPHA\n");
    await git("add", "revert-notes.txt");
    await git("-c", "commit.gpgsign=false", "commit", "-m", "inspector fixture baseline");
    harness.provider.enqueue(
      "revert-alpha",
      { token: "REVERT_ALPHA_PROMPT" },
      { kind: "text", text: "Alpha snapshot retained" },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${parent}/runs`, {
          data: { prompt: "REVERT_ALPHA_PROMPT" },
        })
      ).status(),
    ).toBe(202);
    await waitForRunIdle(request, harness, parent);
    const held = new ScriptGate();
    harness.provider.enqueue(
      "revert-beta",
      { token: "REVERT_BETA_PROMPT" },
      { kind: "text", text: "Beta snapshot retained" },
      held,
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${parent}/runs`, {
          data: { prompt: "REVERT_BETA_PROMPT" },
        })
      ).status(),
    ).toBe(202);
    await held.accepted;
    // A real external edit in this disposable run's workspace is captured by the normal snapshot owner.
    await fs.writeFile(file, "REVERT_BETA\n");
    held.release();
    await waitForRunIdle(request, harness, parent);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${harness.baseUrl}/#/session/${parent}/insights`);
    await expect(page.getByText("Beta snapshot retained", { exact: true })).toBeVisible();
    const operations: string[] = [];
    const workspaceOperations: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "POST" && new URL(sent.url()).pathname === `/sessions/${parent}/revert`)
        operations.push(sent.postData() ?? "");
      if (
        sent.method() === "POST" &&
        /\/workspace\/(branches|commit)$/.test(new URL(sent.url()).pathname)
      )
        workspaceOperations.push(new URL(sent.url()).pathname);
    });
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else await showSidePanel(page);
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    const chooseFile = async () => {
      await fileList(page, mobile);
      const pane = inspectorPane(page, width, "Files");
      await pane.getByRole("button", { name: "All files", exact: true }).click();
      await pane.getByRole("button", { name: /^revert-notes\.txt/ }).click();
    };
    await chooseFile();
    await expect(page.getByText("REVERT_BETA", { exact: true })).toBeVisible();
    const revisions = await (
      await request.get(`${harness.baseUrl}/sessions/${parent}/workspace/revisions`)
    ).json();
    const older = revisions.findIndex((revision: { label: string }) =>
      revision.label.includes("REVERT_ALPHA_PROMPT"),
    );
    expect(older).toBeGreaterThanOrEqual(0);
    await chooseRevision(page, new RegExp(`^Snapshot ${revisions.length - older} ·`), mobile);
    await chooseFile();
    await expect(page.getByText("REVERT_ALPHA", { exact: true })).toBeVisible();
    await fileList(page, mobile);
    await expect(page.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
    await captureInspector(page, `after-${width}-captured-revision`);
    await chooseRevision(page, /^Working tree/, mobile);
    await fileList(page, mobile);
    const branch = page.getByRole("button", { name: "Branch: main", exact: true });
    await branch.focus();
    await page.keyboard.press("Enter");
    const findBranch = page.getByPlaceholder("Find or create a branch");
    await expect(findBranch).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(findBranch).toHaveCount(0);
    await expect(branch).toBeFocused();
    await page.keyboard.press("Enter");
    await findBranch.fill("inspector-feature");
    await page.getByRole("button", { name: "Create inspector-feature", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Branch: inspector-feature", exact: true }),
    ).toBeVisible();
    const commit = page.getByRole("button", { name: "Commit", exact: true });
    await commit.focus();
    await page.keyboard.press("Enter");
    const message = page.getByPlaceholder("Commit message");
    await expect(message).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(message).toHaveCount(0);
    await expect(commit).toBeFocused();
    await page.keyboard.press("Enter");
    await message.fill("inspector accepted fixture commit");
    await message.press("Control+Enter");
    await expect(message).toHaveCount(0);
    await expect
      .poll(async () => (await git("log", "-1", "--format=%s")).stdout.trim())
      .toBe("inspector accepted fixture commit");
    expect(workspaceOperations.filter((url) => url.endsWith("/branches"))).toHaveLength(1);
    expect(workspaceOperations.filter((url) => url.endsWith("/commit"))).toHaveLength(1);
    if (mobile) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Files", exact: true })).toHaveCount(0);
    }
    const trigger = page
      .getByRole("button", { name: "Revert to this snapshot", exact: true })
      .last();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const confirmation = page.getByRole("dialog", { name: "Revert to this snapshot", exact: true });
    await expect(confirmation).toContainText("REVERT_BETA_PROMPT");
    await captureInspector(page, `after-${width}-revert-confirmation`);
    expect(operations).toHaveLength(0);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(operations).toHaveLength(0);
    expect(await fs.readFile(file, "utf8")).toBe("REVERT_BETA\n");
    await page.keyboard.press("Enter");
    await confirmation.getByRole("button", { name: "Revert", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect.poll(() => fs.readFile(file, "utf8")).toBe("REVERT_ALPHA\n");
    await expect(page.getByText("Beta snapshot retained", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Alpha snapshot retained", { exact: true })).toBeVisible();
    expect(operations).toHaveLength(1);
    await captureInspector(page, `after-${width}-revert-settled`);
    harness.provider.assertConsumed();
  });
}
