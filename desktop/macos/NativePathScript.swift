import WebKit

/// This page-world port returns folder information, never filesystem authority.
/// The separate handler checks the exact current native document and launch.
enum NativePathScript {
    static let handler = "nacLocalPaths"
    static let source = #"""
    (() => {
      if (window !== window.top) return;
      let binding = null, retired = false, sequence = 0, pending = null;
      const same = b => binding && b && ['launch','view','document'].every(k => b[k] === binding[k]);
      const post = (kind, request, extra = {}) => {
        window.webkit.messageHandlers.nacLocalPaths.postMessage(JSON.stringify({
          version: 1, kind, ...binding, request, ...extra
        }));
      };
      const cancel = () => {
        const old = pending;
        if (!old) return;
        pending = null;
        old.cleanup();
        try { post('cancel', old.id); } catch {}
        old.resolve(null);
      };
      const port = Object.freeze({
        activate(next) {
          if (retired || binding) return false;
          binding = Object.freeze({...next});
          return true;
        },
        chooseDirectory(initialPath, signal) {
          return new Promise((resolve, reject) => {
            if (retired || !binding || sequence >= 2147483647) {
              reject(new Error('The local workspace folder picker is unavailable.')); return;
            }
            if (signal.aborted) { resolve(null); return; }
            if (typeof initialPath !== 'string' || initialPath.includes('\0') ||
                new TextEncoder().encode(initialPath).length > 16384) {
              reject(new Error('Invalid initial folder.')); return;
            }
            cancel();
            const id = ++sequence;
            const abort = () => { if (pending?.id === id) cancel(); };
            pending = {id, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort)};
            signal.addEventListener('abort', abort, {once: true});
            try { post('choose', id, {initialPath}); }
            catch (error) { const old = pending; pending = null; old.cleanup(); reject(error); }
          });
        },
        settle(expected, request, path, error) {
          if (retired || !same(expected) || !pending || pending.id !== request) return false;
          const old = pending;
          pending = null;
          old.cleanup();
          if (error) old.reject(new Error('The local workspace folder picker is unavailable.'));
          else old.resolve(path);
          return true;
        },
        retire(expected) {
          if (!same(expected)) return;
          // Clear locally; native already cancelled and may have removed its handler.
          retired = true;
          const old = pending; pending = null; binding = null;
          if (old) { old.cleanup(); old.resolve(null); }
        }
      });
      Object.defineProperty(window, '__nacLocalPaths', {value: port, writable: false, configurable: false});
    })();
    """#

    static var userScript: WKUserScript {
        WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
    }
}
