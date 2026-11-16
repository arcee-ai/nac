'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const origin = process.argv.find(value => value.startsWith('--nac-origin='))?.slice(13);
const incarnation = process.argv.find(value => value.startsWith('--nac-incarnation='))?.slice(18);

if (process.isMainFrame && origin && location.origin === origin && incarnation) {
  const nonce = crypto.randomUUID();
  let active = false, retired = false, disconnected = false;
  let owner = null, lifetime = null, visibility = null, visible = true;
  let externalSequence = 0, composing = false;
  const directories = new Map();
  const send = (kind, extra = {}) => {
    if (retired && kind !== 'retired') return;
    ipcRenderer.send('nac:native', { version: 1, kind, nonce, incarnation, ...extra });
  };
  const cancelDirectory = request => {
    const resolve = directories.get(request);
    if (!resolve) return;
    directories.delete(request);
    send('cancel_directory', { request });
    resolve(null);
  };
  const retire = () => {
    if (retired) return false;
    retired = true;
    for (const resolve of directories.values()) resolve(null);
    directories.clear();
    const closing = lifetime;
    owner = null; lifetime = null; visibility = null;
    try { closing?.callback(); return !!closing; } catch { return false; }
  };
  contextBridge.exposeInMainWorld('__nacDesktop', {
    connect(callback) {
      if (retired || owner || typeof callback !== 'function') throw new Error('UI owner unavailable');
      const connection = { callback }; owner = connection;
      if (active) send('ui_ready');
      return () => {
        if (owner !== connection) return;
        owner = null;
        send('ui_retired');
      };
    },
    connectLifetime(callback) {
      if (retired || lifetime || typeof callback !== 'function') throw new Error('UI lifetime unavailable');
      const connection = { callback }; lifetime = connection;
      return () => { if (lifetime === connection) lifetime = null; };
    },
    connectVisibility(callback) {
      if (retired || visibility || typeof callback !== 'function') throw new Error('Visibility owner unavailable');
      const connection = { callback }; visibility = connection;
      callback(visible);
      return () => { if (visibility === connection) visibility = null; };
    },
    reportConnectionLost() {
      if (!active || retired || disconnected || !owner) return;
      disconnected = true;
      send('connection_lost');
    },
  });
  // AbortSignal cannot be marshalled across contextBridge. The page wrapper
  // retains the signal and gives the isolated bridge only bounded form data.
  contextBridge.exposeInMainWorld('__nacDirectoryBridge', {
    choose(initialPath, request) {
      if (!active || retired || typeof initialPath !== 'string' || initialPath.includes('\0') ||
          new TextEncoder().encode(initialPath).length > 16384 ||
          !Number.isSafeInteger(request) || request < 1 || request > 2147483647 || directories.has(request)) return Promise.resolve(null);
      return new Promise(resolve => {
        directories.set(request, resolve);
        send('choose_directory', { request, initialPath });
      });
    },
    cancel: cancelDirectory,
  });
  contextBridge.executeInMainWorld({ func: () => {
    const bridge = window.__nacDirectoryBridge;
    let sequence = 0, pending = null;
    Object.defineProperty(window, '__nacLocalPaths', { configurable: false, writable: false, value: Object.freeze({
      async chooseDirectory(initialPath, signal) {
        if (!signal || typeof signal.addEventListener !== 'function' || signal.aborted || sequence >= 2147483647) return null;
        pending?.();
        const request = ++sequence;
        const cancel = () => bridge.cancel(request);
        pending = cancel;
        signal.addEventListener('abort', cancel, { once: true });
        try { return await bridge.choose(initialPath, request); }
        finally {
          signal.removeEventListener('abort', cancel);
          if (pending === cancel) pending = null;
        }
      },
    }) });
  } });
  ipcRenderer.on('nac:document', (_event, message) => {
    if (!message || message.version !== 1 || message.nonce !== nonce || message.incarnation !== incarnation) return;
    if (message.kind === 'challenge' && !retired && typeof message.challenge === 'string') {
      send('bound', { challenge: message.challenge });
    } else if (message.kind === 'activate' && !retired) {
      active = true;
      visible = message.visible === true;
      visibility?.callback(visible);
      if (owner) send('ui_ready');
    } else if (message.kind === 'retire') {
      const closed = retire();
      send('retired', { closed });
    } else if (message.kind === 'visible' && active && !retired) {
      visible = message.visible === true;
      visibility?.callback(visible);
    } else if (message.kind === 'command' && active && !retired && !disconnected && owner) {
      let accepted = false;
      const focused = document.activeElement;
      const editor = focused instanceof HTMLElement && (focused.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName));
      try { if (!composing && !editor) accepted = owner.callback(message.command) === true; } catch {}
      send('command_settled', { request: message.command.request, accepted });
    } else if (message.kind === 'directory' && active && !retired) {
      const resolve = directories.get(message.request);
      if (resolve) { directories.delete(message.request); resolve(message.path); }
    }
  });
  document.addEventListener('compositionstart', () => { composing = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);
  document.addEventListener('click', event => {
    if (!active || retired || disconnected || !event.isTrusted || event.defaultPrevented || event.button !== 0 || !document.hasFocus()) return;
    const anchor = event.composedPath().find(element => element instanceof HTMLAnchorElement);
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.href); } catch { return; }
    if (url.origin === origin) return;
    event.preventDefault();
    if (anchor.hasAttribute('download') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || externalSequence >= 2147483647) return;
    send('external_link', { request: ++externalSequence, url: anchor.href });
  });
  window.addEventListener('pagehide', retire, { once: true });
  // A cold navigation's preload can run before webContents.getURL() commits.
  // DOMContentLoaded is the first document-owned handshake, with no retry or
  // alternate origin admission. Already-connected UI owners remain buffered.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => send('ready'), { once: true });
  else send('ready');
}
