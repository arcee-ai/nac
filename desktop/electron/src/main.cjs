"use strict";
const { app, BrowserWindow, dialog, Menu, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Engine } = require("./engine.cjs");
const { Lifecycle } = require("./lifecycle.cjs");
const { options, selectConfiguration } = require("./configuration.cjs");
const { validIdentity } = require("./protocol.cjs");
const { createNativeAdapters } = require("./native.cjs");
const { installMenus } = require("./menus.cjs");

app.enableSandbox();
// Test/developer-selected shell storage must be bound before Chromium helpers
// are constructed. Rust configuration/store discovery remains independent.
let earlyProfileError = null;
if (process.env.NAC_ELECTRON_DATA_HOME !== undefined) {
  try {
    const selected = process.env.NAC_ELECTRON_DATA_HOME;
    if (!path.isAbsolute(selected)) throw new Error("invalid shell profile");
    fs.mkdirSync(selected, { recursive: true, mode: 0o700 });
    app.setPath("userData", selected);
    app.setPath("sessionData", selected);
  } catch {
    earlyProfileError = new Error(
      "NAC_ELECTRON_DATA_HOME must name an available absolute shell profile directory. No engine was started.",
    );
  }
}
const lifecycle = new Lifecycle();
let window, native, engine, configuration, launchOptions, identity, schema;
let profileInitialized = false,
  bundleVerified = false;
const securedSessions = new WeakSet();
let approvedExit = false,
  startupPromise = null,
  failure = null,
  failureDialog = false,
  cleanupPromise = null;
const resources = app.isPackaged
  ? process.resourcesPath
  : path.resolve(process.env.NAC_ELECTRON_RESOURCES ?? path.join(__dirname, "../resources"));
const executable =
  !app.isPackaged && process.env.NAC_ELECTRON_ENGINE
    ? path.resolve(process.env.NAC_ELECTRON_ENGINE)
    : path.join(resources, "nac-web");
function reopen() {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}
function status(message) {
  if (!window || window.isDestroyed()) return;
  native?.cancelPending();
  const html =
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>NAC</title><style>body{font:16px -apple-system,sans-serif;max-width:650px;margin:80px auto;padding:30px;color:#ddd;background:#16171a}h1{font-size:24px}p{line-height:1.6}</style><h1>NAC Electron Development</h1><p>' +
    message.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    ) +
    "</p>";
  void window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}
function createWindow(partition) {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: "NAC Electron Development",
    backgroundColor: "#16171a",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: true,
      devTools: !app.isPackaged,
      partition,
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [
        "--nac-origin=" + engine.receipt.endpoint,
        "--nac-incarnation=" + engine.receipt.incarnation,
      ],
    },
  });
  const ownedWindow = window;
  native = createNativeAdapters({
    window,
    endpoint: engine.receipt.endpoint,
    incarnation: engine.receipt.incarnation,
    onConnectionLost: () =>
      fail(new Error("The engine connection was lost. Choose Retry after shutdown completes.")),
  });
  window.on("close", (event) => {
    if (approvedExit) return;
    event.preventDefault();
    if (lifecycle.canHide) {
      native?.cancelPending();
      window.hide();
    }
  });
  window.on("show", () => native?.setVisible(true));
  window.on("hide", () => native?.setVisible(false));
  window.webContents.on("render-process-gone", () => {
    if (lifecycle.phase === "running")
      fail(
        new Error(
          "The workspace renderer exited. Choose Retry after the original engine has stopped.",
        ),
      );
  });
  window.webContents.on("did-fail-load", (_event, code) => {
    if (code !== -3 && lifecycle.phase === "running")
      fail(
        new Error(
          "The bundled workspace could not load. Choose Retry after its engine has stopped.",
        ),
      );
  });
  window.on("closed", () => {
    if (window === ownedWindow) {
      native?.dispose();
      native = null;
      window = null;
    }
  });
  window.once("ready-to-show", () => {
    if (window === ownedWindow) reopen();
  });
  return window;
}
async function fail(error) {
  if (failure || !["running", "confirming"].includes(lifecycle.phase)) return;
  failure = error;
  native?.cancelPending();
  const retiring = native;
  native = null;
  try {
    await retiring?.retire();
  } finally {
    retiring?.dispose();
  }
  const stop = engine?.stop();
  if (window && !window.isDestroyed()) {
    approvedExit = true;
    window.destroy();
    approvedExit = false;
  }
  await stop;
  if (!["running", "confirming"].includes(lifecycle.phase)) return;
  await presentFailure();
}
async function presentFailure() {
  if (failureDialog || !failure || lifecycle.phase !== "running") return;
  failureDialog = true;
  const result = await dialog.showMessageBox({
    type: "error",
    title: "NAC could not open this store",
    message: failure.message,
    detail: bundleVerified
      ? "Retry starts a fresh owned engine with the same configuration only after the previous child has exited. No input is replayed."
      : "Quit and relaunch with valid arguments and a matching complete app bundle. No engine was started.",
    buttons: bundleVerified ? ["Cancel", "Retry"] : ["Close"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  failureDialog = false;
  if (result.response === 1 && lifecycle.phase === "running" && (!engine || engine.exited))
    setImmediate(() => void retry());
}
async function retry() {
  if (
    !bundleVerified ||
    startupPromise ||
    !["running", "confirming"].includes(lifecycle.phase) ||
    (engine && !engine.exited)
  )
    return;
  failure = null;
  const launch = lifecycle.beginLaunch();
  if (!launch) return;
  startupPromise = (async () => {
    try {
      configuration ??= await selectConfiguration(executable, identity, launchOptions);
      if (!["running", "confirming"].includes(lifecycle.phase)) {
        lifecycle.childExited(launch);
        return;
      }
      if (!configureProfile()) {
        lifecycle.childExited(launch);
        return;
      }
      const next = new Engine({
        executable,
        identity,
        schema,
        configuration,
        launcher: path.join(resources, "engine-launcher"),
      });
      engine = next;
      next.once("ready", (receipt) => {
        if (engine !== next || failure || !["running", "confirming"].includes(lifecycle.phase))
          return;
        const partition =
          "persist:nac-" +
          crypto
            .createHash("sha256")
            .update(configuration.store + "\0" + identity.track)
            .digest("hex");
        const ses = session.fromPartition(partition);
        if (!securedSessions.has(ses)) {
          securedSessions.add(ses);
          ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
          ses.setPermissionCheckHandler(() => false);
          ses.setDevicePermissionHandler(() => false);
          ses.on("will-download", (event) => event.preventDefault());
        }
        createWindow(partition);
        void window.loadURL(receipt.endpoint);
      });
      next.once("failure", (error) => {
        if (engine === next) void fail(error);
      });
      next.once("exit", () => lifecycle.childExited(launch));
      next.launch();
    } catch (error) {
      lifecycle.childExited(launch);
      failure = error;
      void presentFailure();
    }
  })().finally(() => {
    startupPromise = null;
  });
  await startupPromise;
}
function waitForCleanup(token) {
  const timer = setTimeout(() => {
    if (lifecycle.timedOut(token)) {
      status(
        "NAC is still waiting for the original engine cleanup. The workspace cannot accept commands. Quit again to continue waiting.",
      );
      reopen();
    }
  }, 26000);
  cleanupPromise?.then(() => clearTimeout(timer));
}
async function beginStop(token) {
  cleanupPromise = (async () => {
    const retiring = native;
    native = null;
    try {
      await retiring?.retire();
    } finally {
      retiring?.dispose();
    }
    if (window && !window.isDestroyed())
      status("Stopping the owned engine and waiting for cleanup…");
    await startupPromise;
    const owned = engine;
    await owned?.stop();
    const decision = lifecycle.stopped(token, !owned || owned.exited);
    if (decision === "terminate") {
      approvedExit = true;
      app.quit();
    } else if (decision === "settled-after-timeout") {
      status("NAC has stopped. Quit again to exit the application.");
      reopen();
    }
  })();
  waitForCleanup(token);
  await cleanupPromise;
}
async function requestQuit() {
  const decision = lifecycle.requestQuit();
  if (decision.kind === "terminate") {
    approvedExit = true;
    app.quit();
    return;
  }
  if (decision.kind === "wait") {
    waitForCleanup(decision.token);
    return;
  }
  if (decision.kind !== "confirm") return;
  reopen();
  const result = await dialog.showMessageBox(window ?? undefined, {
    type: "question",
    title: "Quit NAC?",
    message: "Quit NAC?",
    detail:
      "Work may still be running, waiting for approval, or using an open terminal. Some command outcomes may be unknown. Stop and Quit stops this app’s engine and waits for cleanup. Closing the window keeps work running.",
    buttons: ["Cancel", "Stop and Quit"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  const answer = lifecycle.answer(decision.transaction, result.response === 1);
  if (answer.kind === "stop") void beginStop(answer.token);
  else if (answer.kind === "cancel" && failure) void presentFailure();
}
app.on("before-quit", (event) => {
  if (!approvedExit) {
    event.preventDefault();
    void requestQuit();
  }
});
app.on("window-all-closed", () => {});
app.on("activate", () => {
  reopen();
  if (failure) void presentFailure();
});
app.on("second-instance", () => {
  reopen();
  if (failure) void presentFailure();
});
function configureProfile() {
  if (profileInitialized) return true;
  // Stable per-profile shell identity complements, and never replaces, Rust's lease.
  const profile = crypto
    .createHash("sha256")
    .update(configuration.store + "\0" + identity.track)
    .digest("hex");
  const dataRoot =
    process.env.NAC_ELECTRON_DATA_HOME ??
    path.join(app.getPath("appData"), "NAC Electron", profile);
  app.setPath("userData", dataRoot);
  app.setPath("sessionData", dataRoot);
  if (!app.requestSingleInstanceLock()) {
    approvedExit = true;
    app.quit();
    return false;
  }
  installMenus({
    app,
    Menu,
    getNative: () => native,
    show: reopen,
    requestQuit,
    retry: () => void retry(),
  });
  profileInitialized = true;
  return true;
}
app.whenReady().then(async () => {
  try {
    if (earlyProfileError) throw earlyProfileError;
    const args = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
    launchOptions = options(args);
    identity = JSON.parse(fs.readFileSync(path.join(resources, "engine-identity.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, "manifest.json"), "utf8"));
    schema = manifest.schema;
    if (
      !validIdentity(identity) ||
      !require("node:util").isDeepStrictEqual(identity, manifest.engine_identity) ||
      !Number.isSafeInteger(schema) ||
      crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex") !==
        manifest.engineSha256
    )
      throw new Error(
        "The app manifest does not match its bundled engine identity. Replace the complete app bundle.",
      );
    bundleVerified = true;
    await retry();
  } catch (error) {
    failure = error;
    void presentFailure();
  }
});
// Read-only test diagnostics are reachable only from the Electron main process,
// never through preload. They retain no credentials or renderer authority.
module.exports = {
  getState: () => ({
    phase: lifecycle.phase,
    enginePid: engine?.pid ?? 0,
    receipt: engine?.receipt ?? null,
    failure: failure?.message ?? null,
  }),
  requestQuit,
  reopen,
  retry,
};
