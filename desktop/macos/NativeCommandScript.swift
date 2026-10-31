import WebKit

/// React lives in .page, so this deliberately shares its content world. It is
/// not a security boundary against same-origin script. The native receiver
/// exposes only readiness/settlement, never executable/native operations.
enum NativeCommandScript {
    static let handler = "nacUIReceipt"
    static let source = #"""
    (() => {
      if (window !== window.top) return;
      let owner = null, binding = null, retired = false;
      const same = b => binding && b && ['launch','view','document'].every(k => b[k] === binding[k]);
      const post = (kind, extra = {}) => {
        if (!binding || retired) return;
        window.webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify({
          version: 1, kind, ...binding, ...extra
        }));
      };
      const port = Object.freeze({
        connect(callback) {
          if (retired || owner || typeof callback !== 'function') throw new Error('UI owner unavailable');
          // A stale cleanup must not remove a later use of the same callback.
          const connection = {callback};
          owner = connection;
          if (binding) post('ready');
          return () => {
            if (owner !== connection) return;
            owner = null;
            post('retired');
          };
        },
        activate(next) {
          if (retired || binding) return false;
          binding = Object.freeze({...next});
          if (owner) post('ready');
          return true;
        },
        dispatch(expected, request) {
          if (retired || !same(expected) || !owner) return false;
          let accepted = false;
          try { accepted = owner.callback(request) === true; } catch {}
          post('settled', {request: request.request, accepted});
          return true;
        },
        retire(expected) {
          if (!same(expected)) return;
          // Native already retired and may have removed the receipt handler.
          retired = true; owner = null; binding = null;
        }
      });
      Object.defineProperty(window, '__nacDesktop', {value: port, writable: false, configurable: false});
    })();
    """#

    static var userScript: WKUserScript {
        WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
    }
}
