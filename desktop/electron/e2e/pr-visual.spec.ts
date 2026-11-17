import {
  test,
  expect,
  chromium,
  _electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { ScriptedProvider } from "../../../crates/nac-server/web/e2e/scripted-provider";
import { preparePackagedInspector } from "./packaged-inspector";

const root = path.resolve(__dirname, "../../..");
const fixtureRequire = createRequire(path.join(root, "desktop/electron/package.json"));
const { Engine } = fixtureRequire("./src/engine.cjs");
const { selectConfiguration } = fixtureRequire("./src/configuration.cjs");
const baselineRevision = "7dfe0bec86d2543cc4229049de200e75d253c8d6";
const digest = async (file: string) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: "utf8" }).trim();
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("public PR comparison captures baseline browser and actual Electron shared workspace", async ({}, info) => {
  test.skip(
    process.env.NAC_ELECTRON_PR_VISUAL !== "1",
    "Explicit exact-revision visual evidence lane",
  );
  test.setTimeout(180000);
  const baseEngine = path.resolve(
    process.env.NAC_PR_VISUAL_BASE_ENGINE || "missing-baseline-engine",
  );
  const appBundle = path.resolve(process.env.NAC_ELECTRON_APP || "missing-current-app");
  const expectedHead = process.env.NAC_PR_VISUAL_HEAD_REVISION;
  expect(expectedHead, "Name the exact current packaged source revision").toBeTruthy();
  const resources = path.join(appBundle, "Contents/Resources");
  const manifest = JSON.parse(await fs.readFile(path.join(resources, "manifest.json"), "utf8"));
  expect(manifest.sourceRevision).toBe(expectedHead);
  const baseIdentity = JSON.parse(run(baseEngine, ["__desktop-identity"]));
  expect(baseIdentity.source_revision).toBe(baselineRevision);
  const baseSchema = Number(
    run("/usr/bin/git", [
      "-C",
      root,
      "show",
      `${baselineRevision}:crates/nac-core/src/store/schema.rs`,
    ]).match(/const STORE_SCHEMA_VERSION: i64 = (\d+);/)?.[1],
  );
  expect(baseSchema).toBeGreaterThan(0);
  expect(await digest(path.join(resources, "nac-web"))).toBe(manifest.engineSha256);
  expect(await digest(path.join(resources, "engine-launcher"))).toBe(manifest.engineLauncherSha256);
  const scale = Number(process.env.NAC_PR_VISUAL_DPR || "2");
  expect(scale).toBeGreaterThan(0);
  expect(scale).toBeLessThanOrEqual(4);

  // Both sequential arms use these identical public-safe fixture locations.
  // The private profile is reset only after exact owned engine/app retirement.
  const directory = await fs.realpath(await fs.mkdtemp("/tmp/nac-pr-visual-"));
  const workspace = path.join(directory, "workspace");
  const profile = path.join(directory, "profile");
  const reference = path.join(directory, "reference.txt");
  await fs.mkdir(workspace, { mode: 0o700 });
  await fs.writeFile(
    path.join(workspace, "README.md"),
    "# Desktop review workspace\n\nA disposable public visual fixture.\n",
  );
  await fs.writeFile(reference, "export const answer = 42;\n");
  run("/usr/bin/git", ["init", "--quiet", workspace]);
  run("/usr/bin/git", ["-C", workspace, "add", "README.md"]);
  run("/usr/bin/git", [
    "-C",
    workspace,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "visual fixture",
  ]);
  const provider = new ScriptedProvider();
  await provider.start();
  const metadata: any = {
    version: 1,
    purpose:
      "Comparable public PR visual evidence; renderer content, not native chrome or paint latency",
    baseline: {
      source_revision: baselineRevision,
      shell: "Real Chromium browser; existing standalone React frontend",
      engine_identity: baseIdentity,
      engine_sha256: await digest(baseEngine),
    },
    current: {
      source_revision: manifest.sourceRevision,
      shell: "Actual packaged Electron; same standalone React entry",
      engine_identity: manifest.engine_identity,
      engine_sha256: manifest.engineSha256,
      manifest_sha256: await digest(path.join(resources, "manifest.json")),
      electron: manifest.electron,
      assets: manifest.assets,
    },
    fixture: {
      root: directory,
      workspace,
      store: path.join(profile, "store.db"),
      independent_profiles_at_same_path: true,
      model: "gpt-5.6-sol",
      project: "Desktop review workspace",
      content_sha256: await digest(reference),
    },
    display: {
      viewport: { width: 1280, height: 800 },
      theme: "dark",
      zoom: 1,
      device_scale_factor: scale,
      png_scale: "css",
    },
    captions: {
      workspace:
        "The complete existing React workspace is retained; before is a real browser, after is the Electron webview.",
      project_form:
        "Both normal New Project forms show the same configured local working folder; this pair does not claim native picker actuation.",
      permission:
        "The same real Rust read request reaches the shared permission UI in both shells; no grant or backend change is synthesized.",
      chat: "Both show the completed streamed fixture response after the same explicit Allow once decision.",
    },
    arms: [],
  };
  let allSettled = false;
  try {
    for (const arm of ["before", "after"] as const) {
      await fs.mkdir(profile, { mode: 0o700 });
      const originalProfile = await fs.lstat(profile);
      for (const name of ["home", "nac-home", "xdg", "tmp"])
        await fs.mkdir(path.join(profile, name), { mode: 0o700 });
      const env = {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        HOME: path.join(profile, "home"),
        NAC_HOME: path.join(profile, "nac-home"),
        XDG_CONFIG_HOME: path.join(profile, "xdg"),
        TMPDIR: path.join(profile, "tmp"),
        NAC_ELECTRON_DATA_HOME: path.join(profile, "electron-data"),
        NAC_E2E_API_KEY: "visual-fixture-only",
        MODELS_DEV_URL: `${provider.baseUrl}/models-dev`,
        NAC_ORCHESTRATION: "1",
        BROWSER: "none",
      };
      let owner: any,
        app: ElectronApplication | undefined,
        browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      let appProcess: ReturnType<ElectronApplication["process"]> | undefined;
      let enginePID = 0,
        custodyPID = 0,
        endpoint = "",
        page: Page | undefined,
        settled = false;
      const record: any = { arm, screenshots: [], cleanup: null };
      metadata.arms.push(record);
      try {
        if (arm === "before") {
          const configuration = await selectConfiguration(
            baseEngine,
            baseIdentity,
            { directory: workspace, store: path.join(profile, "store.db"), commandPaths: [] },
            env,
          );
          owner = new Engine({
            executable: baseEngine,
            launcher: path.join(resources, "engine-launcher"),
            identity: baseIdentity,
            schema: baseSchema,
            configuration,
          });
          const ready = new Promise<any>((resolve, reject) => {
            owner.once("ready", resolve);
            owner.once("failure", reject);
          });
          owner.launch();
          const receipt = await ready;
          endpoint = receipt.endpoint;
          enginePID = owner.enginePid;
          custodyPID = owner.child.pid;
          record.launch_receipt = { ...receipt, endpoint: "verified ephemeral IPv4 loopback" };
          browser = await chromium.launch({ headless: false });
          const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: scale,
            colorScheme: "dark",
          });
          page = await context.newPage();
          await page.goto(endpoint);
        } else {
          const executable = path.join(appBundle, "Contents/MacOS/NAC");
          [app] = await Promise.all([
            _electron.launch({
              executablePath: executable,
              args: [
                "--inspect-brk=0",
                "--directory",
                workspace,
                "--store-path",
                path.join(profile, "store.db"),
              ],
              env,
              timeout: 30000,
            }),
            preparePackagedInspector(executable, workspace),
          ]);
          appProcess = app.process();
          expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
          page = await app.firstWindow({ timeout: 15000 });
          await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
          const state = await app.evaluate(({ app }) =>
            process
              .getBuiltinModule("module")
              .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
              .getState(),
          );
          expect(state.receipt.identity).toEqual(manifest.engine_identity);
          enginePID = state.enginePid;
          custodyPID = Number(run("/bin/ps", ["-p", String(enginePID), "-o", "ppid="]));
          expect(run("/bin/ps", ["-p", String(custodyPID), "-o", "ppid="])).toBe(
            String(appProcess.pid),
          );
          endpoint = state.receipt.endpoint;
          record.launch_receipt = {
            ...state.receipt,
            endpoint: "verified ephemeral IPv4 loopback",
          };
          await app.evaluate(({ app, BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.setContentSize(1280, 800);
            window.webContents.setZoomFactor(1);
            window.show();
            window.focus();
            app.focus({ steal: true });
          });
        }
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.getByText("No projects yet", { exact: true })).toBeVisible();
        await expect
          .poll(() =>
            page!.evaluate(() => ({
              width: innerWidth,
              height: innerHeight,
              scale: devicePixelRatio,
              theme: document.documentElement.dataset.theme,
              visualScale: visualViewport?.scale,
            })),
          )
          .toEqual({ width: 1280, height: 800, scale, theme: "dark", visualScale: 1 });
        const api = async (route: string, data?: unknown) => {
          const response = await fetch(endpoint + route, {
            method: data === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json", origin: endpoint },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          });
          if (!response.ok) throw Error(`Visual fixture request failed: ${response.status}`);
          return response.status === 204 ? undefined : response.json();
        };
        const capture = async (scenario: string) => {
          await page!.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          await page!.waitForTimeout(250);
          expect(await page!.locator("body").innerText()).not.toMatch(
            /\/Users\/|\/home\/|visual-fixture-only/,
          );
          const filename = `${arm}-${scenario}.png`;
          const file = info.outputPath(filename);
          const png = await page!.screenshot({ path: file, scale: "css", fullPage: false });
          expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
          record.screenshots.push({
            scenario,
            filename,
            sha256: createHash("sha256").update(png).digest("hex"),
            width: 1280,
            height: 800,
          });
          await info.attach(filename, { path: file, contentType: "image/png" });
        };
        await capture("workspace");
        const model = await api("/model-configs", {
          name: "Visual fixture model",
          backend: "openai-responses",
          model: "gpt-5.6-sol",
          base_url: provider.baseUrl,
          api_key: "visual-fixture-only",
          reasoning_effort: "high",
          extra_headers: {},
          orchestrator_compaction_threshold: 0,
        });
        await page.reload();
        await expect(page.getByText("No projects yet", { exact: true })).toBeVisible();
        await expect
          .poll(() => page!.locator("body").innerText())
          .toContain(path.join(profile, "store.db"));
        await page.getByRole("button", { name: "New Project", exact: true }).click();
        const form = page.getByRole("dialog", { name: "New Project", exact: true });
        await expect(
          form.getByRole("button", { name: `Choose Working Folder: ${workspace}`, exact: true }),
        ).toBeVisible();
        await form
          .getByPlaceholder("Taken from the git remote", { exact: true })
          .fill("Desktop review workspace");
        await capture("project-form");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const project = await api("/projects", {
          name: "Desktop review workspace",
          cwd: workspace,
          default_model_config_id: model.config_id,
        });
        const session = await api("/sessions", {
          behavior: "direct",
          project_id: project.project_id,
        });
        await page.reload();
        await page.evaluate((id) => {
          location.hash = `/session/${id}/files`;
        }, session.metadata.session_id);
        const composer = page.getByRole("combobox", { name: "Message" });
        await expect(composer).toBeVisible();
        provider.enqueue(
          `${arm}-read`,
          { token: "Review the fixture file and summarize the result." },
          {
            kind: "function_call",
            name: "read",
            callId: `${arm}-read`,
            arguments: { path: reference },
            stream: true,
          },
        );
        provider.enqueue(
          `${arm}-answer`,
          { functionOutputCallId: `${arm}-read` },
          {
            kind: "text",
            text: "The shared workspace completed the read.\n\n```js\nexport const answer = 42;\n```",
            stream: true,
          },
        );
        await composer.fill("Review the fixture file and summarize the result.");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
        await capture("permission");
        await page.getByRole("button", { name: "Allow once", exact: true }).click();
        await expect(
          page.getByText("The shared workspace completed the read.", { exact: true }),
        ).toBeVisible();
        await expect
          .poll(
            async () => (await api(`/sessions/${session.metadata.session_id}`)).active_run == null,
          )
          .toBe(true);
        await capture("chat");
        record.display = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          scale: devicePixelRatio,
          theme: document.documentElement.dataset.theme,
        }));
      } finally {
        await browser?.close();
        if (owner) {
          await owner.stop();
          settled = owner.exited && owner.custodySettled && owner.helperClosed;
          record.cleanup = {
            engine_reaped: owner.exited,
            custody_settled: owner.custodySettled,
            custody_helper_reaped: owner.helperClosed,
          };
        }
        if (app && appProcess) {
          if (appProcess.exitCode === null && appProcess.signalCode === null) {
            await app
              .evaluate(({ app, dialog }) => {
                dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
                app.quit();
              })
              .catch(() => {});
            await expect
              .poll(() => appProcess!.exitCode !== null || appProcess!.signalCode !== null, {
                timeout: 30000,
              })
              .toBe(true);
          }
          for (const pid of [enginePID, custodyPID])
            await expect.poll(() => !alive(pid), { timeout: 30000 }).toBe(true);
          settled = true;
          record.cleanup = {
            app_exit_observed: true,
            exact_engine_absent: true,
            exact_custody_absent: true,
          };
        }
        expect(settled, "Keep the private profile if owned cleanup is uncertain").toBe(true);
        const currentProfile = await fs.lstat(profile);
        expect([currentProfile.dev, currentProfile.ino]).toEqual([
          originalProfile.dev,
          originalProfile.ino,
        ]);
        await fs.rm(profile, { recursive: true });
      }
    }
    provider.assertConsumed();
    allSettled = true;
    metadata.result = "PASS";
  } catch (error) {
    metadata.result = "FAIL";
    metadata.error_type = error instanceof Error ? error.name : "unknown";
    throw error;
  } finally {
    await provider.stop();
    const publicJSON = JSON.stringify(metadata, null, 2) + "\n";
    expect(publicJSON).not.toMatch(/\/Users\/|\/home\//);
    await fs.writeFile(info.outputPath("comparison.json"), publicJSON);
    await info.attach("comparison.json", {
      path: info.outputPath("comparison.json"),
      contentType: "application/json",
    });
    if (allSettled) await fs.rm(directory, { recursive: true });
  }
});
