"use strict";
const { randomUUID } = require("node:crypto");

/** A diagnostic pane has no workspace authority or native preload. */
function createStatusWindow({ BrowserWindow }) {
  const pane = new BrowserWindow({
    width: 760,
    height: 540,
    useContentSize: true,
    show: false,
    title: "NAC Cleanup Status",
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
      devTools: false,
      partition: "nac-status-" + randomUUID(),
    },
  });
  const contents = pane.webContents;
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setDevicePermissionHandler(() => false);
  contents.session.on("will-download", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  return pane;
}
function statusURL(message) {
  const escaped = message.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
  const html =
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>NAC</title><style>body{font:16px -apple-system,sans-serif;max-width:650px;margin:60px auto;padding:30px;color:#ddd;background:#16171a}h1{font-size:24px}p{line-height:1.6}</style><h1>NAC Electron Development</h1><p>' +
    escaped +
    "</p>";
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}
module.exports = { createStatusWindow, statusURL };
