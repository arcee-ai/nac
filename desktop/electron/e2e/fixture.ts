import {
  test as base,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ScriptedProvider } from "../../../crates/nac-server/web/e2e/scripted-provider";
import { preparePackagedInspector } from "./packaged-inspector";

export const root = path.resolve(__dirname, "../../..");
export type Candidate = {
  app: ElectronApplication;
  page: Page;
  provider: ScriptedProvider;
  directory: string;
  workspace: string;
  endpoint: string;
  enginePid: number;
  ownedPids: number[];
  project: () => Promise<string>;
  session: (behavior?: string, project?: string) => Promise<string>;
  api: (route: string, data?: unknown, method?: string) => Promise<any>;
};
export const test = base.extend<{ candidate: Candidate; developmentPathOverrides: boolean }>({
  developmentPathOverrides: [true, { option: true }],
  candidate: async ({ developmentPathOverrides }, use, info) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nac-electron-e2e-"));
    const workspace = path.join(directory, "workspace with spaces");
    for (const folder of [workspace, "home", "nac-home", "xdg", "tmp"].map((p) =>
      path.isAbsolute(p) ? p : path.join(directory, p),
    )) {
      await fs.mkdir(folder, { recursive: true });
    }
    execFileSync("/usr/bin/git", ["init", "--quiet", workspace]);
    execFileSync("/usr/bin/git", [
      "-C",
      workspace,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    const provider = new ScriptedProvider();
    await provider.start();
    const packaged = process.env.NAC_ELECTRON_APP;
    const executablePath = packaged ? path.join(packaged, "Contents/MacOS/NAC") : undefined;
    const env: Record<string, string> = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
      HOME: path.join(directory, "home"),
      NAC_HOME: path.join(directory, "nac-home"),
      XDG_CONFIG_HOME: path.join(directory, "xdg"),
      TMPDIR: path.join(directory, "tmp"),
      NAC_E2E_API_KEY: "nac-e2e-dummy-only",
      NAC_ORCHESTRATION: "1",
      MODELS_DEV_URL: `${provider.baseUrl}/models-dev`,
      BROWSER: "none",
      NAC_ELECTRON_ENGINE: path.join(root, "target/release/nac-web"),
      NAC_ELECTRON_RESOURCES: path.join(root, "target/electron-resources"),
      NAC_ELECTRON_DATA_HOME: path.join(directory, "electron-data"),
    };
    if (!developmentPathOverrides) {
      delete env.NAC_ELECTRON_ENGINE;
      delete env.NAC_ELECTRON_RESOURCES;
    }
    const launch = _electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(packaged ? ["--inspect-brk=0"] : [path.join(root, "desktop/electron")]),
        "--directory",
        workspace,
        "--store-path",
        path.join(directory, "store.db"),
      ],
      env,
      timeout: 30000,
    });
    const [app] = await Promise.all([
      launch,
      executablePath ? preparePackagedInspector(executablePath, workspace) : Promise.resolve(),
    ]);
    const applicationProcess = app.process();
    const diagnostics: string[] = [];
    app.on("console", (message) => {
      if (diagnostics.length < 40)
        diagnostics.push(`main ${message.type()}: ${message.text().slice(0, 2000)}`);
    });
    app.on("window", (window) => {
      window.on("pageerror", (error) => {
        if (diagnostics.length < 40) diagnostics.push(`page: ${error.message}`);
      });
      window.on("console", (message) => {
        if (message.type() === "error" && diagnostics.length < 40)
          diagnostics.push(`page: ${message.text().slice(0, 2000)}`);
      });
    });
    let page: Page | undefined;
    let enginePid = 0;
    const ownedPids: number[] = [];
    try {
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(!!packaged);
      page = await app.firstWindow({ timeout: 15000 });
      page.on("response", (response) => {
        if (response.status() >= 400 && diagnostics.length < 40)
          diagnostics.push(`http ${response.status()}: ${new URL(response.url()).pathname}`);
      });
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
      await expect(page.getByText("No projects yet", { exact: true })).toBeVisible();
      const endpoint = new URL(page.url()).origin;
      // Trusted test-controller read of the retained launch owner; this is not
      // exposed through preload and never discovers/adopts another engine.
      enginePid = await app.evaluate(
        ({ app }) =>
          process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
            .getState().enginePid,
      );
      expect(enginePid).toBeGreaterThan(0);
      const custodyPid = Number(
        execFileSync("/bin/ps", ["-p", String(enginePid), "-o", "ppid="], {
          encoding: "utf8",
        }).trim(),
      );
      const custody = execFileSync("/bin/ps", ["-p", String(custodyPid), "-o", "ppid=,comm="], {
        encoding: "utf8",
      }).trim();
      expect(custody).toMatch(new RegExp(`^${applicationProcess.pid}\\s+.*\\/engine-launcher$`));
      ownedPids.push(custodyPid);
      const api = async (
        route: string,
        data?: unknown,
        method = data === undefined ? "GET" : "POST",
      ) => {
        const response = await fetch(endpoint + route, {
          method,
          headers: { "content-type": "application/json", origin: endpoint },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        if (!response.ok)
          throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
        return response.status === 204 ? undefined : response.json();
      };
      const candidate: Candidate = {
        app,
        page,
        provider,
        directory,
        workspace,
        endpoint,
        enginePid,
        api,
        ownedPids,
        project: async () => {
          const model = await api("/model-configs", {
            name: "Electron scripted provider",
            backend: "openai-responses",
            model: "gpt-5.6-sol",
            base_url: provider.baseUrl,
            api_key: "nac-e2e-dummy-only",
            reasoning_effort: "high",
            extra_headers: {},
            orchestrator_compaction_threshold: 0,
          });
          return (
            await api("/projects", {
              name: "Electron fixture project",
              cwd: workspace,
              default_model_config_id: model.config_id,
            })
          ).project_id;
        },
        session: async (behavior = "direct", project?: string) =>
          (
            await api(
              "/sessions",
              project
                ? { behavior, project_id: project }
                : {
                    behavior,
                    cwd: workspace,
                    backend: "openai-responses",
                    model: "gpt-5.6-sol",
                    base_url: provider.baseUrl,
                    api_key_env: "NAC_E2E_API_KEY",
                    reasoning_effort: "high",
                    extra_headers: {},
                    orchestrator_compaction_threshold: 0,
                  },
            )
          ).metadata.session_id,
      };
      await use(candidate);
    } finally {
      let settled = false;
      try {
        if (info.status !== info.expectedStatus) {
          const windowFacts = await app
            .evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows().map((window) => ({
                visible: window.isVisible(),
                focused: window.isFocused(),
                bounds: window.getBounds(),
              })),
            )
            .catch(() => []);
          const documentFacts = await page
            ?.evaluate(() => ({
              focused: document.hasFocus(),
              visibility: document.visibilityState,
              viewport: [innerWidth, innerHeight],
              hash: location.hash,
              hiddenSections: document.querySelectorAll('section[style*="display: none"]').length,
            }))
            .catch(() => null);
          console.log("Window/document facts", JSON.stringify({ windowFacts, documentFacts }));
          const state = await app
            .evaluate(({ app }) =>
              process
                .getBuiltinModule("module")
                .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
                .getState(),
            )
            .catch(() => null);
          await info.attach("bounded-desktop-diagnostics", {
            body: JSON.stringify({ state, diagnostics }, null, 2),
            contentType: "application/json",
          });
          console.log("Desktop failure state", JSON.stringify({ state, diagnostics }));
        }
        // Test controller chooses the ordinary Stop and Quit dialog outcome. It
        // neither bypasses lifecycle nor introduces a production control bridge.
        if (applicationProcess.exitCode === null && applicationProcess.signalCode === null) {
          await app
            .evaluate(({ app, dialog }) => {
              dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
              app.quit();
            })
            .catch(() => {});
          await expect
            .poll(
              () => applicationProcess.exitCode !== null || applicationProcess.signalCode !== null,
              { timeout: 30000 },
            )
            .toBe(true);
        }
        if (enginePid)
          await expect
            .poll(
              () => {
                try {
                  process.kill(enginePid, 0);
                  return true;
                } catch {
                  return false;
                }
              },
              { timeout: 30000 },
            )
            .toBe(false);
        for (const pid of ownedPids)
          await expect
            .poll(
              () => {
                try {
                  process.kill(pid, 0);
                  return true;
                } catch {
                  return false;
                }
              },
              { timeout: 5000 },
            )
            .toBe(false);
        if (info.status === info.expectedStatus && process.env.NAC_ELECTRON_KEEP_FIXTURES !== "1")
          await fs.rm(directory, { recursive: true });
        else
          await info.attach("disposable-profile-location", {
            body: directory,
            contentType: "text/plain",
          });
        settled = true;
      } finally {
        await provider.stop();
        // Controller-only evidence; no paths, launch secrets or raw attachments.
        // Missing/failed cleanup never becomes a successful receipt.
        if (process.env.NAC_ELECTRON_CI_RECORDS)
          await fs.appendFile(
            process.env.NAC_ELECTRON_CI_RECORDS,
            JSON.stringify({
              test: info.titlePath,
              mainPid: applicationProcess.pid,
              enginePid,
              ownedPids,
              settled,
            }) + "\n",
          );
      }
    }
  },
});
export { expect };
