"use strict";

const { externalURL, installNavigation } = require("./navigation.cjs");
const { folderPicker, folderExecutable } = require("./folder.cjs");
const { installMenus } = require("./menus.cjs");
const { randomUUID } = require("node:crypto");
const { workspaceVisible } = require("./window-visibility.cjs");
const { launchPaths } = require("./configuration.cjs");

const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const integer = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const identifier = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value) <= 512 &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function createNativeAdapters({
  window,
  endpoint,
  origin = endpoint,
  incarnation,
  storage,
  onUIReady = () => {},
  onPresentation = () => {},
  onConnectionLost = () => {},
  electron,
  pickFolder,
}) {
  const { ipcMain, shell, app, Menu, dialog } = electron || require("electron");
  const chooseFolder =
    pickFolder ||
    ((initial) => {
      const { resources } = launchPaths({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      });
      return folderPicker(initial, folderExecutable(resources));
    });
  const contents = window.webContents;
  let document = null,
    disposed = false,
    retiring = false,
    picker = null,
    request = 0,
    commandFlight = null;
  let retireResolve = null,
    retireTimer = null;
  let targetFlight = null;
  const clearTarget = (outcome) => {
    if (!targetFlight) return;
    clearTimeout(targetFlight.timer);
    targetFlight.resolve(outcome);
    targetFlight = null;
  };
  const dispatchTarget = () => {
    const flight = targetFlight;
    if (!flight || flight.sent) return;
    if (!current(flight.state) || !flight.state.uiReady || picker || commandFlight) {
      clearTarget("unavailable");
      return;
    }
    // app.show()/window.show() may finish after the original native click.
    // Wait only inside its current document and original deadline. A later
    // hide fences it once visibility has actually been observed.
    if (!workspaceVisible(window, app)) return;
    flight.presented = true;
    if (!flight.state.targetReady || !window.isFocused()) return;
    flight.sent = true;
    flight.generation = flight.state.targetGeneration;
    send("session_target", { targetMessage: flight.message }, flight.state);
  };
  const originMatches = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  // Electron can dispose WebFrameMain before render-process-gone or a queued
  // visibility callback. Accessors themselves throw after disposal; absence is
  // a rejected binding, never an uncaught main-process exception.
  const frameMatches = (event) => {
    try {
      return (
        !disposed &&
        !contents.isDestroyed() &&
        event.sender === contents &&
        event.senderFrame &&
        event.senderFrame === contents.mainFrame &&
        originMatches(event.senderFrame.url) &&
        originMatches(contents.getURL())
      );
    } catch {
      return false;
    }
  };
  const current = (state) => {
    try {
      return (
        document === state &&
        !disposed &&
        !retiring &&
        !contents.isDestroyed() &&
        state.bound &&
        state.frame === contents.mainFrame &&
        originMatches(state.frame.url) &&
        originMatches(contents.getURL())
      );
    } catch {
      return false;
    }
  };
  const send = (kind, extra = {}, state = document) => {
    if (!state || contents.isDestroyed()) return;
    try {
      state.frame.send("nac:document", {
        version: 1,
        kind,
        nonce: state.nonce,
        incarnation,
        ...extra,
      });
    } catch {
      /* Detached/crashed frame has no new capability. Retirement still destroys its document. */
    }
  };
  const cancelPending = () => {
    if (!picker) return;
    picker.cancelled = true;
    picker.operation.cancel();
  };
  const invalidate = () => {
    cancelPending();
    document = null;
    if (commandFlight) clearTimeout(commandFlight.timer);
    commandFlight = null;
    clearTarget("stale");
    if (retireResolve) {
      retireResolve(false);
      retireResolve = null;
      clearTimeout(retireTimer);
    }
  };
  const removeNavigation = installNavigation(window, origin);
  const navigation = (event, _url, inPlace, mainFrame) => {
    if ((event.isMainFrame ?? mainFrame) && !(event.isSameDocument ?? inPlace)) invalidate();
  };
  contents.on("did-start-navigation", navigation);
  contents.on("render-process-gone", invalidate);
  const listener = (event, message) => {
    if (
      !frameMatches(event) ||
      !message ||
      message.version !== 1 ||
      message.incarnation !== incarnation ||
      !uuid(message.nonce)
    )
      return;
    const common = ["version", "kind", "nonce", "incarnation"];
    if (message.kind === "ready") {
      if (!exact(message, common) || document?.bound || retiring) return;
      document = {
        nonce: message.nonce,
        frame: event.senderFrame,
        bound: false,
        challenge: randomUUID(),
        uiReady: false,
        directorySequence: 0,
        externalSequence: 0,
        storageSequence: 0,
        targetReady: false,
        targetGeneration: 0,
        storageDocument: { launch: incarnation, view: randomUUID(), document: message.nonce },
      };
      send("challenge", { challenge: document.challenge });
      return;
    }
    const state = document;
    if (!state || message.nonce !== state.nonce || event.senderFrame !== state.frame) return;
    if (message.kind === "bound") {
      if (
        !exact(message, [...common, "challenge"]) ||
        state.bound ||
        retiring ||
        message.challenge !== state.challenge
      )
        return;
      state.bound = true;
      send("activate", { visible: workspaceVisible(window, app) });
      if (storage)
        void storage.snapshot().then((snapshot) => {
          if (current(state))
            send(
              "storage_open",
              {
                bootstrap: {
                  version: 1,
                  endpoint,
                  document: state.storageDocument,
                  binding: storage.binding,
                  ...snapshot,
                },
              },
              state,
            );
        });
      return;
    }
    if (message.kind === "retired") {
      if (
        !retiring ||
        !exact(message, [...common, "closed"]) ||
        typeof message.closed !== "boolean"
      )
        return;
      if (retireResolve) {
        retireResolve(message.closed);
        retireResolve = null;
        clearTimeout(retireTimer);
      }
      return;
    }
    if (!current(state)) return;
    switch (message.kind) {
      case "session_target_ready":
      case "session_target_retired":
        if (
          !exact(message, [...common, "generation"]) ||
          !integer(message.generation) ||
          message.generation < state.targetGeneration ||
          (message.kind === "session_target_ready" && message.generation === state.targetGeneration)
        )
          break;
        state.targetGeneration = message.generation;
        state.targetReady = message.kind === "session_target_ready";
        if (
          targetFlight?.state === state &&
          targetFlight.sent &&
          (!state.targetReady || targetFlight.generation !== state.targetGeneration)
        )
          clearTarget("stale");
        else dispatchTarget();
        break;
      case "storage": {
        if (!storage || !exact(message, [...common, "operation"])) break;
        const operation = message.operation;
        const base = ["version", "launch", "view", "document", "sequence", "kind"];
        if (
          !operation ||
          operation.version !== 1 ||
          !integer(operation.sequence) ||
          operation.sequence !== state.storageSequence + 1 ||
          !["launch", "view", "document"].every(
            (key) => operation[key] === state.storageDocument[key],
          )
        )
          break;
        let accepted;
        if (operation.kind === "flush" && exact(operation, base))
          accepted = storage.flush().then((durable) => ({ durable }));
        else if (
          operation.kind === "write" &&
          exact(operation, [...base, "namespace", "key", "value"])
        )
          accepted = storage.write(operation.namespace, operation.key, operation.value);
        if (!accepted) break;
        state.storageSequence = operation.sequence;
        void accepted.then(({ durable }) => {
          if (current(state))
            send(
              "storage_ack",
              {
                acknowledgement: {
                  document: state.storageDocument,
                  sequence: operation.sequence,
                  durable,
                },
              },
              state,
            );
        });
        break;
      }
      case "ui_ready":
      case "ui_retired":
        if (exact(message, common)) {
          state.uiReady = message.kind === "ui_ready";
          if (state.uiReady) onUIReady();
        }
        break;
      case "connection_lost":
        if (exact(message, common) && state.uiReady) {
          state.uiReady = false;
          cancelPending();
          onConnectionLost();
        }
        break;
      case "command_settled":
        if (
          exact(message, [...common, "request", "accepted"]) &&
          typeof message.accepted === "boolean" &&
          commandFlight?.request === message.request
        ) {
          clearTimeout(commandFlight.timer);
          commandFlight = null;
        }
        break;
      case "target_settled":
        if (
          exact(message, [...common, "request", "outcome"]) &&
          targetFlight?.state === state &&
          targetFlight.sent &&
          targetFlight.generation === state.targetGeneration &&
          state.targetReady &&
          targetFlight.request === message.request &&
          ["opened", "deferred", "unavailable", "stale"].includes(message.outcome)
        )
          clearTarget(message.outcome);
        break;
      case "external_link":
        if (
          !exact(message, [...common, "request", "url"]) ||
          !integer(message.request) ||
          message.request <= state.externalSequence
        )
          break;
        state.externalSequence = message.request;
        if (
          !state.uiReady ||
          !workspaceVisible(window, app) ||
          !window.isFocused() ||
          picker ||
          !externalURL(message.url, origin)
        )
          break;
        // No URL/state/token diagnostics. An explicit Open link remains retry.
        Promise.resolve(shell.openExternal(message.url)).catch(() => {
          if (current(state) && workspaceVisible(window, app))
            void dialog.showMessageBox(window, {
              type: "error",
              message: "Could not open your browser",
              detail:
                "Use the sign-in Open link in NAC to try again, or cancel the pending sign-in.",
              buttons: ["OK"],
            });
        });
        break;
      case "cancel_directory":
        if (
          exact(message, [...common, "request"]) &&
          integer(message.request) &&
          picker?.state === state &&
          picker.request === message.request
        )
          cancelPending();
        break;
      case "choose_directory": {
        if (
          !exact(message, [...common, "request", "initialPath"]) ||
          !integer(message.request) ||
          message.request <= state.directorySequence ||
          typeof message.initialPath !== "string" ||
          message.initialPath.includes("\0") ||
          Buffer.byteLength(message.initialPath) > 16384
        )
          break;
        state.directorySequence = message.request;
        if (!state.uiReady || !workspaceVisible(window, app) || !window.isFocused() || picker) {
          send("directory", { request: message.request, path: null }, state);
          break;
        }
        const operation = chooseFolder(
          message.initialPath.startsWith("/") ? message.initialPath : "",
        );
        const flight = { operation, state, request: message.request, cancelled: false };
        picker = flight;
        Promise.resolve(operation.promise).then(
          (selected) => {
            if (picker !== flight) return;
            picker = null;
            if (current(state))
              send(
                "directory",
                {
                  request: flight.request,
                  path:
                    !flight.cancelled &&
                    workspaceVisible(window, app) &&
                    typeof selected === "string"
                      ? selected
                      : null,
                },
                state,
              );
          },
          () => {
            if (picker === flight) picker = null;
            if (current(state)) send("directory", { request: flight.request, path: null }, state);
          },
        );
        break;
      }
    }
  };
  ipcMain.on("nac:native", listener);
  window.on("focus", dispatchTarget);
  const native = {
    sessionTarget(session, occurrence) {
      const state = document;
      if (
        !state ||
        !current(state) ||
        !state.uiReady ||
        !storage ||
        picker ||
        commandFlight ||
        targetFlight ||
        !identifier(session) ||
        !identifier(occurrence) ||
        request >= 2147483647
      )
        return Promise.resolve("unavailable");
      const number = ++request;
      return new Promise((resolve) => {
        const timer = setTimeout(() => clearTarget("unavailable"), 3000);
        // One original explicit click may wait for native unhide/focus and this
        // document's React owner after reopen. No dispatched outcome is retried;
        // the same deadline bounds initialization and the eventual ACK.
        targetFlight = {
          state,
          request: number,
          resolve,
          timer,
          sent: false,
          presented: workspaceVisible(window, app),
          message: {
            version: 1,
            request: number,
            source: "notification-response",
            profile: storage.profile.digest,
            ...state.storageDocument,
            target: { session_id: session, occurrence_id: occurrence },
          },
        };
        dispatchTarget();
      });
    },
    command(action) {
      const state = document;
      if (
        !state ||
        !current(state) ||
        !state.uiReady ||
        !workspaceVisible(window, app) ||
        !window.isFocused() ||
        picker ||
        commandFlight ||
        !["newSession", "settings", "projects"].includes(action) ||
        request >= 2147483647
      )
        return false;
      const number = ++request;
      const timer = setTimeout(() => {
        if (commandFlight?.request === number) commandFlight = null;
      }, 1500);
      timer.unref?.();
      commandFlight = { request: number, timer };
      send("command", { command: { version: 1, request: number, action } });
      return true;
    },
    setVisible(visible) {
      if (!visible) {
        cancelPending();
        if (targetFlight?.presented) clearTarget("stale");
      }
      if (document && current(document)) send("visible", { visible: visible === true });
      onPresentation(visible === true && window.isFocused());
      if (visible) dispatchTarget();
    },
    visibilityChanged() {
      native.setVisible(workspaceVisible(window, app));
    },
    cancelPending,
    async retire() {
      if (retiring || disposed) return false;
      retiring = true;
      clearTarget("stale");
      cancelPending();
      const panelSettled = picker ? picker.operation.promise.catch(() => null) : Promise.resolve();
      const closed = document
        ? new Promise((resolve) => {
            retireResolve = resolve;
            retireTimer = setTimeout(() => {
              retireResolve = null;
              resolve(false);
            }, 2000);
            send("retire");
          })
        : Promise.resolve(false);
      const [result] = await Promise.all([closed, panelSettled]);
      return result;
    },
    installMenus({ quit, reopen, retry }) {
      installMenus({ app, Menu, getNative: () => native, show: reopen, requestQuit: quit, retry });
    },
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      ipcMain.removeListener("nac:native", listener);
      window.removeListener("focus", dispatchTarget);
      contents.removeListener("did-start-navigation", navigation);
      contents.removeListener("render-process-gone", invalidate);
      removeNavigation();
    },
  };
  return native;
}

module.exports = { createNativeAdapters };
