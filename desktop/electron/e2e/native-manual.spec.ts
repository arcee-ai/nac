import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { ScriptedProvider } from "../../../crates/nac-server/web/e2e/scripted-provider";
import { identitiesSettled, settleNativeOwner } from "./native-evidence.cjs";

const root = path.resolve(__dirname, "../../..");
const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: "utf8" }).trim();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait<T>(
  read: () => Promise<T>,
  label: string,
  seconds = 30,
): Promise<NonNullable<T>> {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    await pause(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function write(file: string, value: unknown) {
  await fs.writeFile(file + ".next", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(file + ".next", file);
}
const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

test("manual native acceptance holds a private relocated LaunchServices candidate", async ({}, info) => {
  test.skip(
    process.env.NAC_ELECTRON_NATIVE_MANUAL !== "1",
    "Explicit live native actor required; this is never automatic acceptance",
  );
  test.setTimeout(12 * 60 * 1000);
  const bundle = await fs.realpath(
    process.env.NAC_ELECTRON_APP ||
      path.join(root, "target/electron-review-relocation/Folder With Spaces/NAC Electron.app"),
  );
  const resources = path.join(bundle, "Contents/Resources");
  const manifest = JSON.parse(await fs.readFile(path.join(resources, "manifest.json"), "utf8"));
  const enginePath = path.join(resources, "nac-web");
  expect(await sha256(enginePath)).toBe(manifest.engineSha256);
  const output = await fs.mkdtemp(path.join(root, "target/electron-native-manual-"));
  const profile = path.join(output, "private-profile");
  const workspace = path.join(profile, "workspace with spaces");
  const selectedFolder = path.join(profile, "Selected Folder α");
  const runID = randomUUID();
  const revealLeaf = `native-reveal-${runID.slice(0, 8)}.txt`;
  const folderProjectName = "Electron native folder selection";
  const store = path.join(profile, "fixture.db");
  for (const directory of [
    profile,
    workspace,
    selectedFolder,
    "home",
    "nac-home",
    "xdg",
    "tmp",
  ].map((value) => (path.isAbsolute(value) ? value : path.join(profile, value))))
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const originalProfile = await fs.lstat(profile);
  await fs.writeFile(path.join(workspace, revealLeaf), "Private native reveal fixture.\n");
  for (const directory of [workspace, selectedFolder]) {
    run("/usr/bin/git", ["init", "--quiet", directory]);
    run("/usr/bin/git", ["-C", directory, "add", "."]);
    run("/usr/bin/git", [
      "-C",
      directory,
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
      "native fixture",
    ]);
  }
  const sampler = path.join(output, "process-sample");
  const observer = path.join(output, "window-observer");
  run("/usr/bin/xcrun", [
    "clang",
    "-O2",
    path.join(root, "desktop/electron/performance/process_sample.c"),
    "-o",
    sampler,
  ]);
  run("/usr/bin/xcrun", [
    "swiftc",
    "-parse-as-library",
    "-O",
    "-framework",
    "AppKit",
    path.join(root, "desktop/electron/performance/WindowObserver.swift"),
    "-o",
    observer,
  ]);
  const appState = () => JSON.parse(run(observer, ["state", bundle]));
  expect(appState().apps).toEqual([]);
  const sample = (pids: number[]) => JSON.parse(run(sampler, pids.map(String))) as any[];
  const table = () =>
    run("/bin/ps", ["-axo", "pid=,ppid=,comm="])
      .split("\n")
      .flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        return match
          ? [{ pid: Number(match[1]), ppid: Number(match[2]), executable: match[3] }]
          : [];
      });
  const provider = new ScriptedProvider();
  await provider.start();
  const authChild = spawn("python3", [path.join(root, "desktop/macos/external_auth_fixture.py")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH, PYTHONUNBUFFERED: "1" },
  });
  const authLines = createInterface({ input: authChild.stdout });
  const authExit = new Promise<number | null>((resolve, reject) => {
    authChild.once("close", resolve);
    authChild.once("error", reject);
  });
  const authStarted = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Local auth fixture did not start")), 5000);
    authLines.once("line", (line) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(line).origin);
      } catch {
        reject(new Error("Invalid auth fixture receipt"));
      }
    });
    authChild.once("error", reject);
  });
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: path.join(profile, "home"),
    NAC_HOME: path.join(profile, "nac-home"),
    XDG_CONFIG_HOME: path.join(profile, "xdg"),
    TMPDIR: path.join(profile, "tmp"),
    NAC_ELECTRON_DATA_HOME: path.join(profile, "electron-data"),
    NAC_E2E_API_KEY: "nac-native-manual-dummy-only",
    MODELS_DEV_URL: `${provider.baseUrl}/models-dev`,
    BROWSER: "none",
  };
  const require = createRequire(path.join(resources, "app/package.json"));
  let preparation: any;
  let identity: any;
  let endpoint = "";
  let enginePID = 0;
  const known = new Map<number, any>();
  let acceptance: any;
  let primaryError: unknown;
  let observed = { folderProjectCreated: false, browserObserved: false, pkceSucceeded: false };
  const apiAt = (origin: string) => async (route: string, data?: unknown) => {
    const response = await fetch(origin + route, {
      method: data === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (!response.ok) throw new Error(`Private fixture API ${response.status}: ${route}`);
    return response.status === 204 ? undefined : response.json();
  };
  const capture = () => {
    const current = table();
    if (identity) {
      const live = sample([identity.pid])[0];
      if (
        !live.valid ||
        live.birth_sec !== identity.birth_sec ||
        live.birth_usec !== identity.birth_usec
      )
        return current;
    }
    const members = new Set<number>(identity ? [identity.pid] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of current)
        if (members.has(row.ppid) && !members.has(row.pid)) {
          members.add(row.pid);
          changed = true;
        }
    }
    for (const row of sample([...members])) {
      const previous = known.get(row.pid);
      if (
        row.valid &&
        (!previous ||
          (previous.birth_sec === row.birth_sec && previous.birth_usec === row.birth_usec))
      )
        known.set(row.pid, row);
    }
    return current;
  };
  const settled = () => {
    const current = table();
    const records = sample([...known.keys()]);
    return identitiesSettled(
      [...known.values()],
      records,
      current.map((entry) => entry.pid),
    );
  };
  try {
    const auth = await authStarted;
    const { Engine } = require("./src/engine.cjs");
    const { selectConfiguration } = require("./src/configuration.cjs");
    const configuration = await selectConfiguration(
      enginePath,
      manifest.engine_identity,
      { directory: workspace, store, commandPaths: [] },
      env,
    );
    preparation = new Engine({
      executable: enginePath,
      launcher: path.join(resources, "engine-launcher"),
      identity: manifest.engine_identity,
      schema: manifest.schema,
      configuration,
    });
    const prepared = new Promise<any>((resolve, reject) => {
      preparation.once("ready", resolve);
      preparation.once("failure", reject);
    });
    preparation.launch();
    const receipt = await prepared;
    const api = apiAt(receipt.endpoint);
    await api("/provider-connections", {
      backend: "openai-responses", base_url: provider.baseUrl,
      api_key: "nac-native-manual-dummy-only",
    });
    const project = await api("/projects", { name: "Native acceptance workspace", cwd: workspace });
    const session = await api("/sessions", {
      behavior: "direct", project_id: project.project_id, backend: "openai-responses",
      model: "gpt-5.6-sol", base_url: provider.baseUrl, api_key_env: "NAC_E2E_API_KEY",
    });
    const credential = await api("/credentials", { value: "native-manual-public-client" });
    await api("/mcp_library/servers", {
      name: "native-browser-fixture",
      enabled: false,
      transport: "streamable_http",
      url: `${auth}/mcp`,
      headers: {},
      args: [],
      env: {},
    });
    await api("/mcp_library/servers/native-browser-fixture/oauth/configure", {
      registration: { type: "pre_registered", client_id_credential: credential.name },
      scopes: ["fixture:read"],
      authorization_metadata: {
        authorization_endpoint: `${auth}/oauth/authorize/success`,
        token_endpoint: `${auth}/oauth/token`,
        issuer: auth,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      },
    });
    await preparation.stop();
    expect(preparation.exited).toBe(true);
    const launchArgs = [
      "-n",
      ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      "-a",
      bundle,
      "--args",
      "--directory",
      workspace,
      "--store-path",
      store,
    ];
    execFileSync("/usr/bin/open", launchArgs, { env: { PATH: env.PATH }, stdio: "pipe" });
    identity = await wait(async () => {
      const state = appState();
      if (state.apps.length > 1) throw new Error("Ambiguous relocated candidate app");
      return state.apps[0]?.identity_available && state.apps[0]?.visible_window
        ? state.apps[0]
        : null;
    }, "exact LaunchServices app and native window");
    const engine = await wait(async () => {
      const rows = capture();
      const owner = rows.filter(
        (row) =>
          row.ppid === identity.pid && row.executable === path.join(resources, "engine-launcher"),
      );
      if (owner.length > 1) throw new Error("Ambiguous owned engine custody");
      return rows.find((row) => row.ppid === owner[0]?.pid && row.executable === enginePath);
    }, "exact bundled engine/custody relation");
    enginePID = engine.pid;
    endpoint = await wait(async () => {
      try {
        const output = run("/usr/sbin/lsof", [
          "-nP",
          "-a",
          "-p",
          String(enginePID),
          "-iTCP",
          "-sTCP:LISTEN",
          "-Fn",
        ]);
        const ports = output.split("\n").filter((line) => /^n127\.0\.0\.1:\d+$/.test(line));
        return ports.length === 1 ? "http://" + ports[0].slice(1) : null;
      } catch {
        return null;
      }
    }, "owned engine kernel listener");
    const liveAPI = apiAt(endpoint);
    expect((await liveAPI("/sessions/" + session.metadata.session_id)).metadata.session_id).toBe(
      session.metadata.session_id,
    );
    const ready = {
      version: 1,
      run: runID,
      app: bundle,
      appIdentity: identity,
      enginePID,
      engineIdentity: manifest.engine_identity,
      manifestSource: manifest.sourceRevision,
      manifestSha256: await sha256(path.join(resources, "manifest.json")),
      engineSha256: manifest.engineSha256,
      preparation: {
        enginePID: preparation.enginePid,
        custodyPID: preparation.child.pid,
        receipt,
        custody_settled: preparation.custodySettled,
        reaped: preparation.exited,
      },
      store,
      workspace,
      selectedFolder,
      folderProjectName,
      project: project.project_id,
      session: session.metadata.session_id,
      revealLeaf,
      revealPath: path.join(workspace, revealLeaf),
      endpoint,
      launch: "LaunchServices /usr/bin/open -n, no debugger or alternate executable",
      PATH: env.PATH,
      privateProfile: profile,
      knownProcesses: [...known.values()],
      authFixture: auth,
      ready: path.join(output, "ready.json"),
      status: path.join(output, "status.json"),
      finish: path.join(output, "finish.json"),
      finishShape: {
        version: 1,
        run: runID,
        action: "finish",
        folderObserved: true,
        finderObserved: true,
        browserObserved: true,
      },
      safety:
        "Before every CUA attachment independently verify the exact app PID/birth is live. Never getApp/getAXState after Quit; they may relaunch the app.",
    };
    await write(path.join(output, "ready.json"), ready);
    console.log(
      "NATIVE_MANUAL_READY " +
        JSON.stringify({
          output,
          ready: ready.ready,
          pid: identity.pid,
          birth_sec: identity.birth_sec,
          birth_usec: identity.birth_usec,
        }),
    );
    const until = Date.now() + 10 * 60 * 1000;
    while (Date.now() < until) {
      capture();
      const live = sample([identity.pid])[0];
      const appLive =
        live.valid &&
        live.birth_sec === identity.birth_sec &&
        live.birth_usec === identity.birth_usec;
      // Once positively observed, durable creation needs no more engine reads.
      // Quit may close HTTP before the native process is actually reaped.
      if (appLive && !observed.folderProjectCreated) {
        try {
          const projects = await liveAPI("/projects");
          observed.folderProjectCreated ||= projects.projects.some(
            (entry: any) => entry.name === folderProjectName && entry.cwd === selectedFolder,
          );
        } catch (error) {
          const after = sample([identity.pid])[0];
          if (
            after.valid &&
            after.birth_sec === identity.birth_sec &&
            after.birth_usec === identity.birth_usec
          )
            throw error;
        }
      }
      const authEvidence = await (await fetch(`${auth}/evidence`)).json();
      await write(path.join(output, "auth-evidence.json"), authEvidence);
      observed.browserObserved ||= authEvidence.events.some(
        (event: any) =>
          event.kind === "browser_observation" &&
          event.bridge === false &&
          event.webkit_fixture === false,
      );
      observed.pkceSucceeded ||=
        authEvidence.tokens_issued === 1 &&
        authEvidence.events.some(
          (event: any) => event.kind === "token_exchange" && event.pkce_verified === true,
        );
      await write(path.join(output, "status.json"), {
        version: 1,
        run: runID,
        appLive,
        ...observed,
        sampled_at: new Date().toISOString(),
      });
      let finish;
      try {
        finish = JSON.parse(await fs.readFile(path.join(output, "finish.json"), "utf8"));
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      if (finish) {
        if (
          finish.version === 1 &&
          finish.run === runID &&
          finish.action === "abort" &&
          typeof finish.reason === "string" &&
          finish.reason.length > 0 &&
          finish.reason.length <= 512
        )
          throw new Error(`Native acceptance explicitly aborted: ${finish.reason}`);
        expect(finish).toEqual(ready.finishShape);
        expect(observed).toEqual({
          folderProjectCreated: true,
          browserObserved: true,
          pkceSucceeded: true,
        });
        await wait(async () => settled(), "exact app/engine/helper cleanup", 35);
        acceptance = {
          ...ready,
          completed_at: new Date().toISOString(),
          observed,
          manualReceipt: finish,
          authEvidence,
          cleanup_settled: true,
        };
        break;
      }
      await pause(500);
    }
    expect(
      acceptance,
      "Ten-minute native hold expired without a completed actor receipt",
    ).toBeTruthy();
    await write(path.join(output, "acceptance.json"), acceptance);
    await info.attach("native-acceptance", {
      body: JSON.stringify(acceptance),
      contentType: "application/json",
    });
  } catch (error) {
    primaryError = error;
    await write(path.join(output, "controller-failure.json"), {
      version: 1,
      run: runID,
      observed,
      primary: {
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message.slice(0, 2000) : "Unknown controller error",
      },
    });
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      if (preparation && !preparation.exited) await preparation.stop();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (identity) {
        const cleanup = await settleNativeOwner({
          identity,
          current: () => sample([identity.pid])[0],
          capture,
          requestQuit: () => {
            console.log(
              "NATIVE_MANUAL_CLEANUP: choose ordinary Stop and Quit in the already-live private app; no reattachment after exit.",
            );
            run(observer, [
              "terminate",
              bundle,
              String(identity.pid),
              String(identity.birth_sec),
              String(identity.birth_usec),
            ]);
          },
          waitForSettlement: () =>
            wait(async () => settled(), "exact app/engine/helper cleanup after native control", 35),
        });
        await write(path.join(output, "cleanup.json"), {
          version: 1,
          run: runID,
          ...cleanup,
          knownProcesses: [...known.values()],
        });
      }
    } catch (error) {
      cleanupErrors.push(error);
      await write(path.join(output, "cleanup-pending.json"), {
        version: 1,
        run: runID,
        appIdentity: identity,
        knownProcesses: [...known.values()],
        privateProfile: profile,
        cleanup_settled: false,
      });
    }
    try {
      await provider.stop();
    } catch (error) {
      cleanupErrors.push(error);
    }
    authChild.stdin.end('{"kind":"finish"}\n');
    const timer = setTimeout(() => authChild.kill("SIGTERM"), 5000);
    try {
      expect(await authExit).toBe(0);
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      clearTimeout(timer);
      authLines.close();
    }
    const current = await fs.lstat(profile);
    if (
      acceptance &&
      !cleanupErrors.length &&
      originalProfile.dev === current.dev &&
      originalProfile.ino === current.ino
    )
      await fs.rm(profile, { recursive: true });
    if (cleanupErrors.length && !primaryError)
      throw new AggregateError(
        cleanupErrors,
        "Private native fixture cleanup remained uncertain; profile retained",
      );
    if (cleanupErrors.length && primaryError)
      console.error(
        "Native fixture also has unresolved cleanup; see cleanup-pending.json. The original controller error is preserved.",
      );
  }
});
