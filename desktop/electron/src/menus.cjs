"use strict";

function installMenus({
  app,
  Menu,
  getNative,
  getAttention = () => null,
  show,
  requestQuit,
  retry = () => {},
  reload = () => {},
}) {
  const command = (action) => () => getNative()?.command(action);
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: command("settings") },
        {
          label: "Notifications",
          submenu: [
            {
              id: "notifications-enable",
              label: "Enable Notifications",
              type: "checkbox",
              checked: false,
              enabled: false,
              click: (item) => void getAttention()?.setEnabled(item.checked),
            },
            {
              id: "notifications-mute",
              label: "Mute Notifications",
              type: "checkbox",
              checked: false,
              enabled: false,
              click: (item) => void getAttention()?.setMuted(item.checked),
            },
            {
              id: "notifications-reset",
              label: "Reset Notification State",
              enabled: false,
              click: () => void getAttention()?.reset(),
            },
            {
              label: "Clear Completion Indicator",
              click: () => void getAttention()?.clearIndicator(),
            },
            { id: "notifications-status", label: "Notifications: Loading…", enabled: false },
          ],
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: "Quit NAC", accelerator: "CmdOrCtrl+Q", click: () => requestQuit() },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Session", accelerator: "CmdOrCtrl+N", click: command("newSession") },
        { label: "Projects…", accelerator: "CmdOrCtrl+Shift+P", click: command("projects") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { id: "workspace-reload", label: "Reload Workspace", click: () => reload() },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { label: "Show NAC", click: () => show() },
        { role: "front" },
        { type: "separator" },
        { label: "Retry Engine Startup", click: () => retry() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installMenus };
