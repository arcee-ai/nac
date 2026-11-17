'use strict';

// An external URL is never privileged content. Preserve the original string,
// including OAuth query/state bytes, after validating its parsed components.
function externalURL(value, origin) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 16384 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname &&
      !url.username && !url.password && url.origin !== origin;
  } catch { return false; }
}

function installNavigation(window, origin) {
  const contents = window.webContents;
  // All external handoff originates in the isolated preload's trusted anchor
  // listener. Neither redirects nor window.open obtain native browser authority.
  const refuse = event => event.preventDefault();
  contents.on('will-navigate', refuse);
  contents.on('will-frame-navigate', refuse);
  contents.on('will-redirect', refuse);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const download = (event, _item, source) => { if (source === contents) event.preventDefault(); };
  contents.session.on('will-download', download);
  const permission = (_contents, _permission, callback) => callback(false);
  contents.session.setPermissionRequestHandler(permission);
  contents.session.setPermissionCheckHandler(() => false);
  return () => {
    contents.removeListener('will-navigate', refuse);
    contents.removeListener('will-frame-navigate', refuse);
    contents.removeListener('will-redirect', refuse);
    contents.session.removeListener('will-download', download);
  };
}

module.exports = { externalURL, installNavigation };
