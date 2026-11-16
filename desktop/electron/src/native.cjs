'use strict';

const { externalURL, installNavigation } = require('./navigation.cjs');
const { folderPicker, folderExecutable } = require('./folder.cjs');
const { installMenus } = require('./menus.cjs');
const { randomUUID } = require('node:crypto');

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function createNativeAdapters({ window, endpoint, origin = endpoint, incarnation, onConnectionLost = () => {}, electron, pickFolder }) {
  const { ipcMain, shell, app, Menu, dialog } = electron || require('electron');
  const chooseFolder = pickFolder || (initial => {
    const path = require('node:path');
    const resources = app.isPackaged ? process.resourcesPath :
      process.env.NAC_ELECTRON_RESOURCES || path.join(__dirname, '..', 'build');
    return folderPicker(initial, folderExecutable(resources));
  });
  const contents = window.webContents;
  let document = null, disposed = false, retiring = false, picker = null, request = 0, commandFlight = null;
  let retireResolve = null, retireTimer = null;
  const originMatches = url => { try { return new URL(url).origin === origin; } catch { return false; } };
  const frameMatches = event => !disposed && !contents.isDestroyed() && event.sender === contents &&
    event.senderFrame && event.senderFrame === contents.mainFrame && originMatches(event.senderFrame.url) && originMatches(contents.getURL());
  const current = state => document === state && !disposed && !retiring && !contents.isDestroyed() &&
    state.bound && state.frame === contents.mainFrame && originMatches(state.frame.url) && originMatches(contents.getURL());
  const send = (kind, extra = {}, state = document) => {
    if (!state || contents.isDestroyed()) return;
    state.frame.send('nac:document', { version: 1, kind, nonce: state.nonce, incarnation, ...extra });
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
    if (retireResolve) { retireResolve(false); retireResolve = null; clearTimeout(retireTimer); }
  };
  const removeNavigation = installNavigation(window, origin);
  const navigation = (event, _url, inPlace, mainFrame) => {
    if ((event.isMainFrame ?? mainFrame) && !(event.isSameDocument ?? inPlace)) invalidate();
  };
  contents.on('did-start-navigation', navigation);
  contents.on('render-process-gone', invalidate);
  const listener = (event, message) => {
    if (!frameMatches(event) || !message || message.version !== 1 || message.incarnation !== incarnation || !uuid(message.nonce)) return;
    const common = ['version', 'kind', 'nonce', 'incarnation'];
    if (message.kind === 'ready') {
      if (!exact(message, common) || document?.bound || retiring) return;
      document = { nonce: message.nonce, frame: event.senderFrame, bound: false, challenge: randomUUID(),
        uiReady: false, directorySequence: 0, externalSequence: 0 };
      send('challenge', { challenge: document.challenge });
      return;
    }
    const state = document;
    if (!state || message.nonce !== state.nonce || event.senderFrame !== state.frame) return;
    if (message.kind === 'bound') {
      if (!exact(message, [...common, 'challenge']) || state.bound || retiring || message.challenge !== state.challenge) return;
      state.bound = true;
      send('activate', { visible: window.isVisible() });
      return;
    }
    if (message.kind === 'retired') {
      if (!retiring || !exact(message, [...common, 'closed']) || typeof message.closed !== 'boolean') return;
      if (retireResolve) { retireResolve(message.closed); retireResolve = null; clearTimeout(retireTimer); }
      return;
    }
    if (!current(state)) return;
    switch (message.kind) {
      case 'ui_ready':
      case 'ui_retired':
        if (exact(message, common)) state.uiReady = message.kind === 'ui_ready';
        break;
      case 'connection_lost':
        if (exact(message, common) && state.uiReady) { state.uiReady = false; cancelPending(); onConnectionLost(); }
        break;
      case 'command_settled':
        if (exact(message, [...common, 'request', 'accepted']) && typeof message.accepted === 'boolean' && commandFlight?.request === message.request) {
          clearTimeout(commandFlight.timer); commandFlight = null;
        }
        break;
      case 'external_link':
        if (!exact(message, [...common, 'request', 'url']) || !integer(message.request) || message.request <= state.externalSequence) break;
        state.externalSequence = message.request;
        if (!state.uiReady || !window.isVisible() || !window.isFocused() || picker || !externalURL(message.url, origin)) break;
        // No URL/state/token diagnostics. An explicit Open link remains retry.
        Promise.resolve(shell.openExternal(message.url)).catch(() => {
          if (current(state) && window.isVisible()) void dialog.showMessageBox(window, {
            type: 'error', message: 'Could not open your browser',
            detail: 'Use the sign-in Open link in NAC to try again, or cancel the pending sign-in.', buttons: ['OK'],
          });
        });
        break;
      case 'cancel_directory':
        if (exact(message, [...common, 'request']) && integer(message.request) && picker?.state === state && picker.request === message.request) cancelPending();
        break;
      case 'choose_directory': {
        if (!exact(message, [...common, 'request', 'initialPath']) || !integer(message.request) || message.request <= state.directorySequence ||
          typeof message.initialPath !== 'string' || message.initialPath.includes('\0') || Buffer.byteLength(message.initialPath) > 16384) break;
        state.directorySequence = message.request;
        if (!state.uiReady || !window.isVisible() || !window.isFocused() || picker) { send('directory', { request: message.request, path: null }, state); break; }
        const operation = chooseFolder(message.initialPath.startsWith('/') ? message.initialPath : '');
        const flight = { operation, state, request: message.request, cancelled: false };
        picker = flight;
        Promise.resolve(operation.promise).then(selected => {
          if (picker !== flight) return;
          picker = null;
          if (current(state)) send('directory', { request: flight.request,
            path: !flight.cancelled && window.isVisible() && typeof selected === 'string' ? selected : null }, state);
        }, () => {
          if (picker === flight) picker = null;
          if (current(state)) send('directory', { request: flight.request, path: null }, state);
        });
        break;
      }
    }
  };
  ipcMain.on('nac:native', listener);
  const native = {
    command(action) {
      const state = document;
      if (!state || !current(state) || !state.uiReady || !window.isVisible() || !window.isFocused() || picker || commandFlight ||
        !['newSession', 'settings', 'projects'].includes(action) || request >= 2147483647) return false;
      const number = ++request;
      const timer = setTimeout(() => { if (commandFlight?.request === number) commandFlight = null; }, 1500);
      timer.unref?.();
      commandFlight = { request: number, timer };
      send('command', { command: { version: 1, request: number, action } });
      return true;
    },
    setVisible(visible) {
      if (!visible) cancelPending();
      if (document && current(document)) send('visible', { visible: visible === true });
    },
    visibilityChanged() { native.setVisible(window.isVisible()); },
    cancelPending,
    async retire() {
      if (retiring || disposed) return false;
      retiring = true;
      cancelPending();
      const panelSettled = picker ? picker.operation.promise.catch(() => null) : Promise.resolve();
      const closed = document ? new Promise(resolve => {
        retireResolve = resolve;
        retireTimer = setTimeout(() => { retireResolve = null; resolve(false); }, 2000);
        send('retire');
      }) : Promise.resolve(false);
      const [result] = await Promise.all([closed, panelSettled]);
      return result;
    },
    installMenus({ quit, reopen, retry }) { installMenus({ app, Menu, getNative: () => native, show: reopen, requestQuit: quit, retry }); },
    dispose() {
      if (disposed) return;
      invalidate(); disposed = true;
      ipcMain.removeListener('nac:native', listener);
      contents.removeListener('did-start-navigation', navigation);
      contents.removeListener('render-process-gone', invalidate);
      removeNavigation();
    },
  };
  return native;
}

module.exports = { createNativeAdapters };
