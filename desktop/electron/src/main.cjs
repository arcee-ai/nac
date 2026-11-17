"use strict";
const { app, BrowserWindow, dialog, Menu, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Engine } = require("./engine.cjs");
const { Lifecycle } = require("./lifecycle.cjs");
const { options, selectConfiguration, launchPaths } = require("./configuration.cjs");
const { validIdentity } = require("./protocol.cjs");
const { createNativeAdapters } = require("./native.cjs");
const { installMenus } = require("./menus.cjs");
const { installWindowVisibility } = require("./window-visibility.cjs");
const { createStatusWindow, statusURL } = require("./status-window.cjs");

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
let window, native, windowVisibility, engine, configuration, launchOptions, identity, schema;
let profileInitialized = false,
  bundleVerified = false;
const securedSessions = new WeakSet();
let approvedExit = false,
  startupPromise = null,
  failure = null,
  failureEpisode = null,
  failureDialog = false,
  cleanupPromise = null;
const { resources, executable } = launchPaths({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});
function reopen() {
  app.show();
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    windowVisibility?.refresh();
  }
}
function status(message) {
  if (!window || window.isDestroyed()) {
    const owner = createStatusWindow({ BrowserWindow });
    window = owner;
    if (failureEpisode && !failureEpisode.window) failureEpisode.window = owner;
    owner.on("close", (event) => {
      if (approvedExit) return;
      event.preventDefault();
      if (window === owner && lifecycle.canHide) owner.hide();
    });
    owner.on("closed", () => {
      if (window === owner) window = null;
    });
    owner.once("ready-to-show", () => {
      if (window === owner) reopen();
    });
  }
  native?.cancelPending();
  void window.loadURL(statusURL(message)).catch(() => {});
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
  const ownedNative = native;
  const visibility = installWindowVisibility({
    window: ownedWindow,
    native: ownedNative,
    app,
    isCurrent: () => window === ownedWindow && native === ownedNative,
  });
  windowVisibility = visibility;
  ownedWindow.on("close", (event) => {
    if (approvedExit) return;
    event.preventDefault();
    if (window === ownedWindow && lifecycle.canHide) {
      ownedNative.cancelPending();
      ownedWindow.hide();
      // AppKit can deduplicate hide when this window was already occluded.
      // The explicit close operation must still publish its current fact.
      visibility.refresh();
    }
  });
  window.webContents.on("render-process-gone", () => {
    if (window === ownedWindow && lifecycle.phase === "running")
      fail(
        new Error(
          "The workspace renderer exited. Choose Retry after the original engine has stopped.",
        ),
      );
  });
  window.webContents.on("did-fail-load", (_event, code) => {
    if (window === ownedWindow && code !== -3 && lifecycle.phase === "running")
      fail(
        new Error(
          "The bundled workspace could not load. Choose Retry after its engine has stopped.",
        ),
      );
  });
  window.on("closed", () => {
    visibility.dispose();
    if (windowVisibility === visibility) windowVisibility = null;
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
  const episode = { error, window, engine, retired: false, settled: false, settlement: null };
  failureEpisode = episode;
  const retiring = native;
  retiring?.cancelPending();
  native = null;
  episode.settlement = (async () => {
    try {
      await retiring?.retire();
    } finally {
      retiring?.dispose();
      episode.retired = true;
    }
    if (
      failureEpisode === episode &&
      lifecycle.phase === "running" &&
      window === episode.window &&
      !episode.engine?.exited
    )
      status("The workspace connection was lost. Waiting for the owned engine to finish cleanup…");
    await episode.engine?.stop();
    episode.settled = true;
  })();
  await episode.settlement;
  if (failureEpisode === episode && failure === error) await presentFailure();
}
async function presentFailure() {
  if (failureDialog || !failure || lifecycle.phase !== "running") return;
  const error = failure,
    episode = failureEpisode;
  failureDialog = true;
  try {
    if (episode?.retired && window === episode.window && !episode.engine?.exited)
      status("The workspace connection was lost. Waiting for the owned engine to finish cleanup…");
    await episode?.settlement;
    if (failure !== error || failureEpisode !== episode || lifecycle.phase !== "running") return;
    // The native Quit choice has now settled. Until that point its exact
    // BrowserWindow stays alive even when the document/engine have retired.
    if (episode?.window && window === episode.window && !window.isDestroyed()) {
      approvedExit = true;
      window.destroy();
      approvedExit = false;
    }
    const result = await dialog.showMessageBox({
      type: "error",
      title: "NAC could not open this store",
      message: error.message,
      detail: bundleVerified
        ? "Retry starts a fresh owned engine with the same configuration only after the previous child has exited. No input is replayed."
        : "Quit and relaunch with valid arguments and a matching complete app bundle. No engine was started.",
      buttons: bundleVerified ? ["Cancel", "Retry"] : ["Close"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (
      result.response === 1 &&
      failure === error &&
      failureEpisode === episode &&
      lifecycle.phase === "running" &&
      (!engine || engine.exited)
    )
      setImmediate(() => {
        if (failure === error && failureEpisode === episode) void retry();
      });
  } catch {
    // A dismissed native error dialog keeps the same failure available from
    // Dock/reopen or explicit Retry; it never starts a successor engine.
  } finally {
    failureDialog = false;
  }
}
async function retry() {
  // Child reap alone does not retire its document or dispose the Quit owner.
  if (
    !bundleVerified ||
    startupPromise ||
    lifecycle.phase !== "running" ||
    (engine && !engine.exited) ||
    (failureEpisode &&
      (!failureEpisode.settled || (failureEpisode.window && !failureEpisode.window.isDestroyed())))
  )
    return;
  failure = null;
  failureEpisode = null;
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
  const failed = failureEpisode;
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
    // A concurrent failure already captured the native adapter before it
    // cleared the public slot. Join its original retirement and owned stop.
    await failed?.settlement;
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
  let result;
  try {
    result = await dialog.showMessageBox(window ?? undefined, {
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
  } catch {
    // A rejected/dismissed sheet is Cancel, never implicit Stop or a stranded
    // confirming transaction. The original choice token fences late callbacks.
    result = { response: 0 };
  }
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
