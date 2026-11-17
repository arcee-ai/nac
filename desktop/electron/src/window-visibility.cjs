"use strict";

function workspaceVisible(window, app) {
  return window.isVisible() && !window.isMinimized() && app.isHidden?.() !== true;
}

/** AppKit may deliver hide after a reopen. Publish the current owned window's
 * fact after the native callback batch, never the callback name as state. */
function installWindowVisibility({ window, native, app, isCurrent }) {
  let pending = null,
    disposed = false;
  const current = () => !disposed && !window.isDestroyed() && isCurrent();
  const publish = () => {
    if (!current() || pending !== null) return;
    pending = setImmediate(() => {
      pending = null;
      if (current()) native.setVisible(workspaceVisible(window, app));
    });
  };
  const hide = () => {
    if (!current()) return;
    native.cancelPending();
    publish();
  };
  const shows = ["show", "restore"],
    hides = ["hide", "minimize"];
  const appEvents = ["activate", "did-become-active", "did-resign-active"];
  shows.forEach((event) => window.on(event, publish));
  hides.forEach((event) => window.on(event, hide));
  appEvents.forEach((event) => app.on(event, publish));
  return {
    refresh: publish,
    dispose() {
      disposed = true;
      if (pending !== null) clearImmediate(pending);
      pending = null;
      shows.forEach((event) => window.removeListener(event, publish));
      hides.forEach((event) => window.removeListener(event, hide));
      appEvents.forEach((event) => app.removeListener(event, publish));
    },
  };
}
module.exports = { installWindowVisibility, workspaceVisible };
