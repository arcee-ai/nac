import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import type { EmbeddedHarness } from "./harness";
import type { TaskLaunchRecord } from "../src/app/types/api";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";

const execute = promisify(execFile);
test.use({ managedNativeWeb: false });

for (const withoutRandomUUID of [false, true]) {
  test(`Local UI opens and steers two pinned retained tasks after restart${withoutRandomUUID ? " without randomUUID" : ""}`, ({
    harness,
    page,
    request,
  }, info) => retainedJourney({ harness, page, request }, info, withoutRandomUUID));
}

async function withTaskIdentityCapability(
  page: Page,
  withoutRandomUUID: boolean,
  launch: () => Promise<void>,
) {
  if (withoutRandomUUID) {
    // Simulate HTTP capabilities only during the retained-task click. Keep
    // real getRandomValues; this loopback origin is not LAN qualification.
    await page.evaluate(() =>
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        value: undefined,
        configurable: true,
      }),
    );
  }
  try {
    await launch();
  } finally {
    if (withoutRandomUUID)
      await page.evaluate(() => Reflect.deleteProperty(globalThis.crypto, "randomUUID"));
  }
}

async function retainedJourney(
  { harness, page, request }: { harness: EmbeddedHarness; page: Page; request: APIRequestContext },
  testInfo: TestInfo,
  withoutRandomUUID: boolean,
) {
  const repo = path.join(harness.runRoot, "workspace");
  const git = (...args: string[]) => execute("git", ["-C", repo, ...args]);
  await fs.mkdir(path.join(repo, "nested"));
  await fs.writeFile(path.join(repo, "nested/seed"), "committed");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "nested seed",
  );
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("branch", "predecessor", head);
  await fs.writeFile(path.join(repo, "nested/seed"), "staged source");
  await git("add", ".");
  await fs.writeFile(path.join(repo, "nested/seed"), "unstaged source");
  await fs.writeFile(path.join(repo, "untracked"), "source only");
  const index = await fs.readFile(path.join(repo, ".git/index"));
  const project = await createProject(request, harness, {
    cwd: path.join(repo, "nested"),
    name: "Retained Local fixture",
  });
  const invoking = await createSession(request, harness, "direct", project);
  await page.goto(`${harness.baseUrl}/#/session/${invoking}/files`);
  await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
  // A broken source fails visibly; ordinary creation requires explicit intent.
  const metadata = path.join(harness.runRoot, "saved-git-metadata");
  await fs.rename(path.join(repo, ".git"), metadata);
  await fs.writeFile(path.join(repo, ".git"), "gitdir: /missing-nac-gitdir\n");
  await page
    .getByRole("button", { name: /^New [Ss]ession$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Agent Session", exact: true }).click();
  const sourceError = page.getByRole("dialog").filter({ hasText: "Git source unavailable" });
  await expect(sourceError).toBeVisible();
  await sourceError.getByRole("button", { name: "Use existing checkout" }).click();
  await expect(sourceError).not.toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(invoking));
  await fs.unlink(path.join(repo, ".git"));
  await fs.rename(metadata, path.join(repo, ".git"));
  await page.goto(`${harness.baseUrl}/#/session/${invoking}/files`);
  await page
    .getByRole("button", { name: /^New [Ss]ession$/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Agent Session", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "New isolated task" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("First retained task");
  await dialog
    .getByRole("textbox", { name: "Initial brief", exact: true })
    .fill("FIRST_RETAINED_BRIEF");
  await dialog
    .getByRole("textbox", { name: "Git ref (optional)", exact: true })
    .fill("predecessor");
  await dialog
    .getByRole("textbox", { name: "Save project default branch", exact: true })
    .fill("main");
  await page.screenshot({ path: testInfo.outputPath("retained-task-form.png") });
  harness.provider.enqueue(
    "first-retained",
    { token: "FIRST_RETAINED_BRIEF" },
    { kind: "text", text: "First task ready" },
  );
  await withTaskIdentityCapability(page, withoutRandomUUID, () =>
    dialog.getByRole("button", { name: "Start isolated task", exact: true }).click(),
  );
  const firstCard = dialog.locator("article").filter({ hasText: "First retained task" });
  await expect(firstCard).toContainText("Task ready");
  await expect(firstCard).toContainText(head);
  await git("branch", "-D", "predecessor");
  await dialog.getByRole("button", { name: "Start another intentional task" }).click();
  await dialog
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Second retained task");
  await dialog
    .getByRole("textbox", { name: "Initial brief", exact: true })
    .fill("SECOND_RETAINED_BRIEF");
  await dialog.getByRole("textbox", { name: "Git ref (optional)", exact: true }).fill("");
  harness.provider.enqueue(
    "second-retained",
    { token: "SECOND_RETAINED_BRIEF" },
    { kind: "text", text: "Second task ready" },
  );
  await withTaskIdentityCapability(page, withoutRandomUUID, () =>
    dialog.getByRole("button", { name: "Start isolated task", exact: true }).click(),
  );
  await expect(dialog.locator("article").filter({ hasText: "Second retained task" })).toContainText(
    "Task ready",
  );
  await page.screenshot({ path: testInfo.outputPath("retained-task-inventory.png") });
  const records = (await (
    await request.get(`${harness.baseUrl}/projects/${project}/task-launches`)
  ).json()) as TaskLaunchRecord[];
  expect(records).toHaveLength(2);
  const first = records.find((r) => r.request.title === "First retained task");
  const second = records.find((r) => r.request.title === "Second retained task");
  if (!first || !second) throw new Error("Missing independently launched tasks");
  expect(first.session_id).not.toBe(second.session_id);
  for (const record of records) {
    expect(record.source.commit).toBe(head);
    expect(record.source.excluded_source_edits).toBe(true);
    expect(await fs.readFile(path.join(record.workspace_path, "nested/seed"), "utf8")).toBe(
      "committed",
    );
    await waitForRunIdle(request, harness, record.session_id);
  }
  await firstCard.getByRole("link", { name: "Open task" }).click();
  await expect(page).toHaveURL(new RegExp(first.session_id));
  await expect(page.getByText("First task ready", { exact: true })).toBeVisible();
  await harness.restart("1", undefined, true);
  await page.reload();
  const retry = await request.post(`${harness.baseUrl}/task-launches`, { data: first.request });
  expect(retry.ok()).toBe(true);
  expect((await retry.json()).session_id).toBe(first.session_id);
  for (const [record, token, response] of [
    [first, "STEER_FIRST_RETAINED", "First independently steered"],
    [second, "STEER_SECOND_RETAINED", "Second independently steered"],
  ] as const) {
    await page.goto(`${harness.baseUrl}/#/session/${record.session_id}/files`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await expect(composer).toBeVisible();
    harness.provider.enqueue(token, { token }, { kind: "text", text: response, stream: true });
    await composer.fill(token);
    await page
      .locator("form")
      .filter({ has: composer })
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await expect(page.getByText(response, { exact: true })).toBeVisible();
    await waitForRunIdle(request, harness, record.session_id);
  }
  await fs.writeFile(path.join(first.workspace_path, "retained-work"), "keep after delete");
  const removed = await request.delete(`${harness.baseUrl}/sessions/${first.session_id}`);
  expect(removed.ok()).toBe(true);
  expect(await fs.readFile(path.join(first.workspace_path, "retained-work"), "utf8")).toBe(
    "keep after delete",
  );
  expect((await git("rev-parse", "HEAD")).stdout.trim()).toBe(head);
  expect(await fs.readFile(path.join(repo, ".git/index"))).toEqual(index);
  expect(await fs.readFile(path.join(repo, "nested/seed"), "utf8")).toBe("unstaged source");
  expect(await fs.readFile(path.join(repo, "untracked"), "utf8")).toBe("source only");
}
