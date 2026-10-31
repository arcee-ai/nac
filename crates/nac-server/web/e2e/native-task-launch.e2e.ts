import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import type { Page } from "@playwright/test";
import { ScriptGate } from "./scripted-provider";

const execute = promisify(execFile);
test.use({ managedNativeWeb: false });

interface Receipt {
  navigation: string;
  launch: { session_id: string; project_id: string; phase: string; error: string | null };
  retained_launch: null | {
    workspace_path: string;
    source: { commit: string; excluded_source_edits: boolean };
  };
}

function functionOutput(value: unknown, callId: string): string | undefined {
  if (Array.isArray(value))
    return value.map((item: unknown) => functionOutput(item, callId)).find(Boolean);
  if (value === null || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  if (
    object.type === "function_call_output" &&
    object.call_id === callId &&
    typeof object.output === "string"
  )
    return object.output;
  return Object.values(object)
    .map((item) => functionOutput(item, callId))
    .find(Boolean);
}

async function send(page: Page, prompt: string) {
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect(composer).toBeVisible();
  await composer.fill(prompt);
  await page
    .locator("form")
    .filter({ has: composer })
    .getByRole("button", { name: "Send", exact: true })
    .click();
}

test("native saved-project launches open independent named-skill tasks across Git and non-Git projects", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const source = path.join(harness.runRoot, "workspace");
  const destination = path.join(harness.runRoot, "destination");
  const ordinary = path.join(harness.runRoot, "ordinary");
  const git = (cwd: string, ...args: string[]) => execute("git", ["-C", cwd, ...args]);
  async function skill(cwd: string) {
    const directory = path.join(cwd, ".agents/skills/launch-proof");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "SKILL.md"),
      "---\nname: launch-proof\ndescription: Verify one independent task handoff.\n---\nRead this skill and reply with NATIVE_SKILL_READ.\n",
    );
    await fs.writeFile(path.join(cwd, "seed"), "committed");
  }
  for (const cwd of [source, destination, ordinary]) await skill(cwd);
  await git(destination, "init", "-b", "main");
  for (const cwd of [source, destination]) {
    await git(cwd, "add", ".");
    await git(
      cwd,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "skill fixture",
    );
  }
  const sourceHead = (await git(source, "rev-parse", "HEAD")).stdout.trim();
  const destinationDefault = (await git(destination, "rev-parse", "HEAD")).stdout.trim();
  await git(destination, "checkout", "-b", "other-current-head");
  await fs.writeFile(path.join(destination, "seed"), "other branch");
  await git(destination, "add", "seed");
  await git(
    destination,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "other branch",
  );
  await fs.writeFile(path.join(source, "seed"), "staged source");
  await git(source, "add", "seed");
  await fs.writeFile(path.join(source, "seed"), "unstaged source");
  await fs.writeFile(path.join(source, "source-only"), "untracked source");
  const sourceIndex = await fs.readFile(path.join(source, ".git/index"));
  const same = await createProject(request, harness, { cwd: source, name: "Native same project" });
  const cross = await createProject(request, harness, {
    cwd: destination,
    name: "Native destination project",
  });
  const local = await createProject(request, harness, {
    cwd: ordinary,
    name: "Native ordinary directory",
  });
  const caller = await createSession(request, harness, "direct", same);
  await page.goto(`${harness.baseUrl}/#/session/${caller}/insights`);
  harness.provider.enqueue(
    "discover",
    {
      token: "DISCOVER_NATIVE_PROJECTS",
      requiredTools: ["list_projects", "launch_task", "task_launch_status"],
    },
    {
      kind: "function_call",
      stream: "request",
      name: "list_projects",
      callId: "discover",
      arguments: { query: null },
    },
  );
  harness.provider.enqueue(
    "discover-ack",
    { functionOutputCallId: "discover" },
    { kind: "text", stream: "request", text: "Saved projects discovered" },
  );
  await send(page, "DISCOVER_NATIVE_PROJECTS");
  await expect(page.getByText("Saved projects discovered", { exact: true })).toBeVisible();
  const discovery = functionOutput(
    harness.provider.requests.find((r) => r.matchedStep === "discover-ack")?.body,
    "discover",
  );
  expect(discovery).toContain(cross);
  expect(discovery).toContain(local);
  const candidates = JSON.parse(discovery!) as {
    ambiguous: boolean;
    candidates: Array<{ project_id: string }>;
  };
  expect(candidates.ambiguous).toBe(true);
  expect(new Set(candidates.candidates.map((project) => project.project_id)).size).toBe(3);
  const receipts: Receipt[] = [];
  const intents: Record<string, unknown>[] = [];
  for (const [kind, project] of [
    ["same", null],
    ["cross", cross],
    ["ordinary", local],
  ] as const) {
    const callId = `native-launch-${kind}`;
    const title = `Native ${kind} task`;
    const input = {
      request_id: randomUUID(),
      project_id: project,
      title,
      prompt: `NATIVE_CHILD_${kind}: only these handoff facts`,
      skill: "launch-proof",
      ...(kind === "ordinary" ? {} : { default_ref: "main" }),
      ...(kind === "same" ? { model: "gpt-5.6-sol", reasoning_effort: "low" } : {}),
    };
    intents.push(input);
    harness.provider.enqueue(
      `launch-${kind}`,
      { token: `NATIVE_LAUNCH_${kind}` },
      { kind: "function_call", stream: "request", name: "launch_task", callId, arguments: input },
    );
    harness.provider.enqueue(
      `launch-ack-${kind}`,
      { functionOutputCallId: callId },
      { kind: "text", stream: "request", text: `Separate ${kind} launch accepted` },
    );
    harness.provider.enqueue(
      `skill-${kind}`,
      { token: `NATIVE_CHILD_${kind}`, forbiddenToken: callId, requiredTools: ["read"] },
      {
        kind: "function_call",
        stream: "request",
        name: "read",
        callId: `skill-${kind}`,
        arguments: { path: ".agents/skills/launch-proof/SKILL.md" },
      },
    );
    harness.provider.enqueue(
      `child-done-${kind}`,
      { functionOutputCallId: `skill-${kind}` },
      { kind: "text", stream: "request", text: `NATIVE_SKILL_READ_${kind}` },
    );
    await send(page, `NATIVE_LAUNCH_${kind}: Start a separate task using the launch-proof skill.`);
    const acknowledgement = page.getByText(`Separate ${kind} launch accepted`, { exact: true });
    const allow = page
      .getByRole("button", { name: "Allow once", exact: true })
      .and(page.locator(":enabled"));
    // Ordinary agent authorization can ask separately for the destination and pinned Git effects.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.race([
        acknowledgement.waitFor({ state: "visible" }),
        allow.waitFor({ state: "visible" }),
      ]);
      if (await acknowledgement.isVisible()) break;
      await allow.click();
    }
    await expect(acknowledgement).toBeVisible();
    const output = functionOutput(
      harness.provider.requests.find((r) => r.matchedStep === `launch-ack-${kind}`)?.body,
      callId,
    );
    if (!output) throw new Error("No native launch receipt reached the caller");
    const receipt = JSON.parse(output) as Receipt;
    receipts.push(receipt);
    expect(receipt.navigation).toBe(`/session/${receipt.launch.session_id}`);
    const link = page.getByRole("link", { name: `Open separate task: ${title}`, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${receipt.launch.session_id}/insights`));
    await page.goto(`${harness.baseUrl}/#${receipt.navigation}`);
    await expect(page).toHaveURL(new RegExp(`${receipt.launch.session_id}/insights`));
    await expect(page.getByText(`NATIVE_SKILL_READ_${kind}`, { exact: true })).toBeVisible();
    await waitForRunIdle(request, harness, receipt.launch.session_id);
    const goal = await request.get(`${harness.baseUrl}/sessions/${receipt.launch.session_id}/goal`);
    expect(await goal.json()).toBeNull();
    const childRequest = harness.provider.requests.find((r) => r.matchedStep === `skill-${kind}`);
    expect(JSON.stringify(childRequest?.body)).toContain("Use the requested skill $launch-proof.");
    expect(JSON.stringify(childRequest?.body)).not.toContain("DISCOVER_NATIVE_PROJECTS");
    await page.goto(`${harness.baseUrl}/#/session/${caller}/insights`);
  }
  expect(new Set(receipts.map((r) => r.launch.session_id)).size).toBe(3);
  const inventory = async (project: string) =>
    (await (
      await request.get(`${harness.baseUrl}/projects/${project}/task-launches`)
    ).json()) as Array<{ session_id: string; source: { commit: string }; workspace_path: string }>;
  const sameRecords = await inventory(same);
  const crossRecords = await inventory(cross);
  expect(sameRecords[0].source.commit).toBe(sourceHead);
  expect(crossRecords[0].source.commit).toBe(destinationDefault);
  expect(await fs.readFile(path.join(sameRecords[0].workspace_path, "seed"), "utf8")).toBe(
    "committed",
  );
  expect(await fs.readFile(path.join(source, ".git/index"))).toEqual(sourceIndex);
  expect(await fs.readFile(path.join(source, "seed"), "utf8")).toBe("unstaged source");
  expect(await fs.readFile(path.join(source, "source-only"), "utf8")).toBe("untracked source");
  const baselineAssets = process.env.NAC_NATIVE_BASELINE_ASSETS;
  if (baselineAssets) {
    await page.route("**/assets/dist/**", (route) => {
      const relative = new URL(route.request().url()).pathname.split("/assets/dist/")[1];
      if (!relative || relative.includes("..")) throw new Error("Invalid baseline asset path");
      return route.fulfill({ path: path.join(baselineAssets, relative) });
    });
    await page.route(harness.baseUrl + "/", (route) =>
      route.fulfill({ path: path.join(baselineAssets, "index.html"), contentType: "text/html" }),
    );
    await page.reload();
    await expect(
      page.getByText("Separate ordinary launch accepted", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Loading conversation", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeVisible();
    await page.evaluate(() =>
      (
        globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
      ).document.fonts.ready.then(() => undefined),
    );
    await page.screenshot({
      path: info.outputPath("native-task-before.png"),
      animations: "disabled",
    });
    await page.unrouteAll();
    await page.reload();
  }
  await expect(
    page.getByRole("link", { name: "Open separate task: Native ordinary task", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading conversation", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("combobox", { name: "Message", exact: true })).toBeVisible();
  await page.evaluate(() =>
    (
      globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
    ).document.fonts.ready.then(() => undefined),
  );
  await page.screenshot({ path: info.outputPath("native-task-after.png"), animations: "disabled" });
  await harness.restart("1", undefined, true);
  await page.reload();
  harness.provider.enqueue(
    "retry",
    { token: "RETRY_NATIVE_SAME" },
    {
      kind: "function_call",
      stream: "request",
      name: "launch_task",
      callId: "retry",
      arguments: intents[0],
    },
  );
  harness.provider.enqueue(
    "retry-ack",
    { functionOutputCallId: "retry" },
    { kind: "text", stream: "request", text: "Original task recovered" },
  );
  await send(page, "RETRY_NATIVE_SAME: retry the exact launch after restart.");
  await expect(page.getByText("Original task recovered", { exact: true })).toBeVisible();
  const retried = JSON.parse(
    functionOutput(
      harness.provider.requests.find((r) => r.matchedStep === "retry-ack")?.body,
      "retry",
    )!,
  ) as Receipt;
  expect(retried.launch.session_id).toBe(receipts[0].launch.session_id);
  expect((await inventory(same)).length).toBe(1);
  for (const [index, id] of [caller, ...receipts.map((r) => r.launch.session_id)].entries()) {
    const token = `INDEPENDENT_STEER_${index}`;
    harness.provider.enqueue(
      token,
      { token },
      { kind: "text", stream: "request", text: `${token} accepted` },
    );
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    await send(page, token);
    await expect(page.getByText(`${token} accepted`, { exact: true })).toBeVisible();
    await waitForRunIdle(request, harness, id);
  }
  for (const kind of ["same", "cross", "ordinary"])
    expect(harness.provider.requests.filter((r) => r.matchedStep === `skill-${kind}`)).toHaveLength(
      1,
    );
  const cancelTarget = receipts[0].launch.session_id;
  const cancelGate = new ScriptGate();
  harness.provider.enqueue(
    "cancel-target",
    { token: "CANCEL_NATIVE_TASK" },
    { kind: "text", stream: "request", text: "Cancelled output" },
    cancelGate,
  );
  await page.goto(`${harness.baseUrl}/#/session/${cancelTarget}/insights`);
  await send(page, "CANCEL_NATIVE_TASK");
  await cancelGate.accepted;
  try {
    const cancelled = await request.post(
      `${harness.baseUrl}/sessions/${cancelTarget}/cancel-active-run`,
    );
    expect(cancelled.ok()).toBe(true);
    await waitForRunIdle(request, harness, cancelTarget);
  } finally {
    cancelGate.release();
  }
  harness.provider.enqueue(
    "status",
    { token: "READ_NATIVE_STATUS" },
    {
      kind: "function_call",
      stream: "request",
      name: "task_launch_status",
      callId: "native-status",
      arguments: { request_id: intents[0].request_id },
    },
  );
  harness.provider.enqueue(
    "status-ack",
    { functionOutputCallId: "native-status" },
    { kind: "text", stream: "request", text: "Passive launch status read" },
  );
  await page.goto(`${harness.baseUrl}/#/session/${caller}/insights`);
  const targetRequests = harness.provider.requests.filter(
    (r) => r.matchedStep === "cancel-target",
  ).length;
  await send(page, "READ_NATIVE_STATUS");
  await expect(page.getByText("Passive launch status read", { exact: true })).toBeVisible();
  const status = JSON.parse(
    functionOutput(
      harness.provider.requests.find((r) => r.matchedStep === "status-ack")?.body,
      "native-status",
    )!,
  ) as {
    launch: { session_id: string };
    approvals: string;
    task: { run_outcomes: Array<{ disposition: string }> };
  };
  expect(status.launch.session_id).toBe(cancelTarget);
  expect(status.approvals).toContain("unknown");
  expect(status.task.run_outcomes[0].disposition).toBe("cancelled");
  expect(harness.provider.requests.filter((r) => r.matchedStep === "cancel-target")).toHaveLength(
    targetRequests,
  );
});
