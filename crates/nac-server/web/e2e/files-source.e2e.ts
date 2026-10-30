import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

import {
  createProject,
  createSession,
  expect,
  test,
  waitForRunIdle,
} from "./harness";

const execute = promisify(execFile);

const WORKING_TREE = "Working tree — all checkout changes";

async function showFiles(page: Page, mobile: boolean) {
  const files = page.getByRole("tab", { name: "Files", exact: true });
  if (mobile) {
    if (!(await files.first().isVisible()))
      await page
        .getByRole("button", { name: "Open panel", exact: true })
        .click();
    await files.last().click();
  } else if (!(await files.isVisible())) {
    await page.getByRole("button", { name: "Show panel", exact: true }).click();
  }
  await expect(files.last()).toBeVisible();
}

/** A phone's panel shows one screen at a time: an open file goes back to the list. */
async function openFileList(page: Page, mobile: boolean) {
  const back = page.getByRole("button", { name: "Open list", exact: true });
  if (mobile && (await back.isVisible())) await back.click();
}

async function selectRevision(page: Page, name: RegExp, mobile: boolean) {
  await openFileList(page, mobile);
  if (mobile)
    await page
      .getByRole("tab", { name: "History", exact: true })
      .last()
      .click();
  else await page.getByRole("button", { name: /^Snapshot:/ }).click();
  await page.getByRole("button", { name }).click();
  if (mobile)
    await page.getByRole("tab", { name: "Files", exact: true }).last().click();
}

/** A changed file's row in the list, named by its file name and git status. */
function fileRow(page: Page, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", {
    name: new RegExp(
      `^${escaped}(?:\\s*, (?:Modified|Added|Deleted|Renamed|Untracked))?$`,
    ),
  });
}

async function showChanged(page: Page, mobile: boolean) {
  await openFileList(page, mobile);
  const changed = page.getByRole("button", {
    name: "Diff of changed files",
    exact: true,
  });
  if ((await changed.getAttribute("aria-pressed")) !== "true")
    await changed.click();
}

for (const mobile of [false, true]) {
  test(`labels working-tree and captured-run changes truthfully ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    );
    const label = page.getByRole("status", { name: "Files source" });
    const expectLabel = async (...parts: string[]) => {
      for (const part of parts) await expect(label).toContainText(part);
    };

    const workspace = path.join(harness.runRoot, "files-source");
    await fs.mkdir(workspace);
    const git = (...args: string[]) =>
      execute("git", ["-C", workspace, ...args]);
    await git("init", "-b", "main");
    await git("config", "user.name", "Disposable NAC fixture");
    await git("config", "user.email", "nac-fixture@example.test");
    await git("config", "commit.gpgsign", "false");
    await fs.writeFile(
      path.join(workspace, "tracked.txt"),
      "COMMITTED_CONTENT\n",
    );
    await fs.writeFile(
      path.join(workspace, "obsolete.txt"),
      "OBSOLETE_CONTENT\n",
    );
    await git("add", ".");
    await git("commit", "-m", "fixture baseline");
    // Unrelated changes the checkout already carries before any run.
    await fs.writeFile(
      path.join(workspace, "tracked.txt"),
      "EDITED_BEFORE_SESSION\n",
    );
    await fs.rm(path.join(workspace, "obsolete.txt"));
    await fs.writeFile(
      path.join(workspace, "notes.txt"),
      "UNTRACKED_BEFORE_SESSION\n",
    );

    const project = await createProject(request, harness, {
      name: "Files source",
      cwd: workspace,
    });
    const id = await createSession(request, harness, "direct", project);
    const mode = await request.put(
      `${harness.baseUrl}/sessions/${id}/permissions/mode`,
      {
        data: { mode: "auto_approve" },
      },
    );
    expect(mode.ok()).toBe(true);

    // The first run writes nothing, so its capture holds the earlier edits; the
    // second writes one new file, which is all its own capture then records.
    harness.provider.enqueue(
      "SOURCE_BASELINE",
      { token: "SOURCE_BASELINE" },
      { kind: "text", text: "baseline captured", stream: "request" },
    );
    harness.provider.enqueue(
      "SOURCE_AGENT_WRITE",
      { token: "SOURCE_AGENT_WRITE", requiredTools: ["write"] },
      {
        kind: "function_call",
        name: "write",
        callId: "source-agent-write",
        arguments: {
          path: "agent-output.txt",
          content: "WRITTEN_BY_AGENT\n",
          expected_revision: null,
        },
      },
    );
    harness.provider.enqueue(
      "SOURCE_AGENT_DONE",
      { functionOutputCallId: "source-agent-write" },
      { kind: "text", text: "agent file written", stream: "request" },
    );
    for (const prompt of ["SOURCE_BASELINE", "SOURCE_AGENT_WRITE"]) {
      const submitted = await request.post(
        `${harness.baseUrl}/sessions/${id}/runs`,
        {
          data: { prompt },
        },
      );
      expect(submitted.ok()).toBe(true);
      await waitForRunIdle(request, harness, id);
    }
    harness.provider.assertConsumed();
    const settled = (await (
      await request.get(`${harness.baseUrl}/sessions/${id}`)
    ).json()) as {
      run_failure?: unknown;
    };
    expect(settled.run_failure ?? null).toBeNull();
    expect(
      await fs.readFile(path.join(workspace, "agent-output.txt"), "utf8"),
    ).toBe("WRITTEN_BY_AGENT\n");
    const revisions = (await (
      await request.get(`${harness.baseUrl}/sessions/${id}/workspace/revisions`)
    ).json()) as { id: number; run_id: string; label: string }[];
    expect(revisions).toHaveLength(2);
    const agentRun = revisions.find((entry) =>
      entry.label.includes("SOURCE_AGENT_WRITE"),
    );
    expect(agentRun).toBeTruthy();
    // A person edits the checkout again once the run is over.
    await fs.writeFile(
      path.join(workspace, "after-run.txt"),
      "WRITTEN_AFTER_RUN\n",
    );

    await page.goto(`${harness.baseUrl}/#/session/${id}/files`);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    await showFiles(page, mobile);
    await showChanged(page, mobile);

    // The working tree lists every change in the checkout, whoever made it.
    const everything = [
      "tracked.txt",
      "obsolete.txt",
      "notes.txt",
      "agent-output.txt",
    ];
    for (const name of [...everything, "after-run.txt"])
      await expect(fileRow(page, name)).toBeVisible();
    await expectLabel(WORKING_TREE);
    if (!mobile) await expectLabel("Opened first for navigation");
    await expect(
      page.getByRole("button", { name: "Back to working tree" }),
    ).toHaveCount(0);

    // The agent's run: only what its capture recorded, named by run and time.
    await selectRevision(page, /^Snapshot 2 ·/, mobile);
    await showChanged(page, mobile);
    await expect(fileRow(page, "agent-output.txt")).toBeVisible();
    for (const name of [
      "tracked.txt",
      "obsolete.txt",
      "notes.txt",
      "after-run.txt",
    ])
      await expect(fileRow(page, name)).toHaveCount(0);
    await expectLabel(
      "Snapshot 2 — captured after a run",
      `Run ${agentRun!.run_id.slice(0, 8)}`,
      "Changes since Snapshot 1",
    );
    await expect(label).not.toContainText(WORKING_TREE);
    await expect(
      page.getByRole("button", { name: "Commit", exact: true }),
    ).toBeDisabled();

    // The first capture carries the checkout's earlier edits and says so.
    await selectRevision(page, /^Snapshot 1 ·/, mobile);
    await showChanged(page, mobile);
    for (const name of ["tracked.txt", "obsolete.txt", "notes.txt"])
      await expect(fileRow(page, name)).toBeVisible();
    for (const name of ["agent-output.txt", "after-run.txt"])
      await expect(fileRow(page, name)).toHaveCount(0);
    await expectLabel(
      "Snapshot 1 — captured after a run",
      "Changes since the last commit, including earlier edits",
    );

    await page.getByRole("button", { name: "Back to working tree" }).click();
    await showChanged(page, mobile);
    for (const name of [...everything, "after-run.txt"])
      await expect(fileRow(page, name)).toBeVisible();
    await expectLabel(WORKING_TREE);
    await expect(label).not.toContainText("Snapshot");
    await expect(
      page.getByRole("button", { name: "Commit", exact: true }),
    ).toBeEnabled();

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    await showFiles(page, mobile);
    await showChanged(page, mobile);
    for (const name of [...everything, "after-run.txt"])
      await expect(fileRow(page, name)).toBeVisible();
    await expectLabel(WORKING_TREE);
  });
}
