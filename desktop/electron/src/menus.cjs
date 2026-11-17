'use strict';

function installMenus({ app, Menu, getNative, show, requestQuit, retry = () => {} }) {
  const command = action => () => getNative()?.command(action);
  const template = [
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: command('settings') },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { label: 'Quit NAC', accelerator: 'CmdOrCtrl+Q', click: () => requestQuit() },
    ] },
    { label: 'File', submenu: [
      { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: command('newSession') },
      { label: 'Projects…', accelerator: 'CmdOrCtrl+Shift+P', click: command('projects') },
      { type: 'separator' }, { role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
      { label: 'Show NAC', click: () => show() }, { role: 'front' },
      { type: 'separator' }, { label: 'Retry Engine Startup', click: () => retry() },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installMenus };
