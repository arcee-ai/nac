import WebKit

/// Page-world presentation capability, not a boundary against same-origin script.
/// Native validates the actual view/frame/origin and existing document binding.
enum WorkspaceStorageScript {
    static let handler = "nacPresentationStorage"
    static let source = #"""
    (() => {
      if (window !== window.top) return;
      let binding = null, retired = false, closed = false, resolveBootstrap;
      const listeners = new Set();
      const bootstrap = new Promise(resolve => { resolveBootstrap = resolve; });
      const same = value => binding && value &&
        ['launch', 'view', 'document'].every(key => value[key] === binding[key]);
      const port = Object.freeze({
        open() { return bootstrap; },
        subscribe(callback) {
          if (closed || typeof callback !== 'function') return () => {};
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        write(message) {
          if (closed || retired || !same(message)) return false;
          try {
            window.webkit.messageHandlers.nacPresentationStorage.postMessage(JSON.stringify(message));
            return true;
          } catch { return false; }
        },
        activate(value) {
          if (retired || binding || !value || !value.document) return false;
          binding = Object.freeze({...value.document});
          resolveBootstrap(value);
          return true;
        },
        settled(expected, sequence, durable) {
          if (closed || retired || !same(expected)) return false;
          for (const callback of listeners) callback({document: expected, sequence, durable});
          return true;
        },
        retire(expected) {
          if (!same(expected)) return false;
          retired = true; closed = true; listeners.clear();
          return true;
        },
        close() { closed = true; listeners.clear(); }
      });
      Object.defineProperty(window, '__nacDesktopStorage', {value: port, writable: false, configurable: false});
    })();
    """#

    static var userScript: WKUserScript {
        WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
    }
}
