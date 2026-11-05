import WebKit

/// React lives in .page, so this deliberately shares its content world. It is
/// not a security boundary against same-origin script. The native receiver
/// exposes only readiness/settlement, never executable/native operations.
enum NativeCommandScript {
    static let handler = "nacUIReceipt"
    static let source = #"""
    (() => {
      if (window !== window.top) return;
      let owner = null, lifetime = null, binding = null, retired = false, disconnected = false;
      let targetOwner = null, targetProfile = null, targetFlight = null;
      let visibilityOwner = null, visible = true;
      const same = b => binding && b && ['launch','view','document'].every(k => b[k] === binding[k]);
      const post = (kind, extra = {}) => {
        if (!binding || retired) return;
        window.webkit.messageHandlers.nacUIReceipt.postMessage(JSON.stringify({
          version: 1, kind, ...binding, ...extra
        }));
      };
      const retireView = () => {
        if (retired) return false;
        // Native already retired and may have removed the receipt handler.
        const closing = lifetime;
        retired = true; owner = null; lifetime = null; binding = null;
        targetOwner = null; targetFlight = null; visibilityOwner = null; targetProfile = null;
        if (!closing) return false;
        try { closing.callback(); return true; } catch { return false; }
      };
      const port = Object.freeze({
        connectSessionTarget(callback) {
          if (retired || targetOwner || typeof callback !== 'function') throw new Error('Target owner unavailable');
          const connection = {callback}; targetOwner = connection;
          if (binding && targetProfile) post('session_target_ready', {profile: targetProfile});
          return () => {
            if (targetOwner !== connection) return;
            targetOwner = null; targetFlight = null;
            if (binding && targetProfile) post('session_target_retired', {profile: targetProfile});
          };
        },
        activateSessionTarget(expected, profile) {
          if (retired || disconnected || !same(expected) || targetProfile || typeof profile !== 'string') return false;
          targetProfile = profile;
          if (targetOwner) post('session_target_ready', {profile});
          return true;
        },
        dispatchSessionTarget(expected, request) {
          if (retired || disconnected || !same(expected) || !targetOwner || request.profile !== targetProfile ||
              !['launch','view','document'].every(k => request[k] === binding[k])) return false;
          const flight = {owner: targetOwner, binding, profile: targetProfile}; targetFlight = flight;
          Promise.resolve().then(() => targetFlight === flight ? flight.owner.callback(request) : 'stale').then(outcome => {
            if (retired || disconnected || targetFlight !== flight || targetOwner !== flight.owner || binding !== flight.binding) return;
            targetFlight = null;
            post('session_target_settled', {profile: flight.profile, request: request.request,
              outcome: ['opened','deferred','unavailable','stale'].includes(outcome) ? outcome : 'unavailable'});
          }, () => {
            if (retired || disconnected || targetFlight !== flight || targetOwner !== flight.owner || binding !== flight.binding) return;
            targetFlight = null;
            post('session_target_settled', {profile: flight.profile, request: request.request, outcome: 'unavailable'});
          });
          return true;
        },
        connectVisibility(callback) {
          if (retired || visibilityOwner || typeof callback !== 'function') throw new Error('Visibility owner unavailable');
          const connection = {callback}; visibilityOwner = connection; callback(visible);
          return () => { if (visibilityOwner === connection) visibilityOwner = null; };
        },
        setVisibility(expected, next) {
          if (retired || !same(expected) || typeof next !== 'boolean') return false;
          visible = next; visibilityOwner?.callback(visible); return true;
        },
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
        connectLifetime(callback) {
          if (retired || lifetime || typeof callback !== 'function') throw new Error('UI lifetime unavailable');
          const connection = {callback};
          lifetime = connection;
          return () => { if (lifetime === connection) lifetime = null; };
        },
        reportConnectionLost() {
          if (retired || disconnected || !binding || !owner) return;
          disconnected = true;
          targetFlight = null;
          post('connection_lost');
        },
        activate(next) {
          if (retired || binding) return false;
          binding = Object.freeze({...next});
          if (owner) post('ready');
          return true;
        },
        dispatch(expected, request) {
          if (retired || disconnected || !same(expected) || !owner) return false;
          let accepted = false;
          try { accepted = owner.callback(request) === true; } catch {}
          post('settled', {request: request.request, accepted});
          return true;
        },
        retire(expected) {
          if (!same(expected)) return false;
          return retireView();
        },
        // Native-only destruction of this concrete view. No dispatch, input,
        // engine or binding admission is granted by this disposal operation.
        retireView
      });
      Object.defineProperty(window, '__nacDesktop', {value: port, writable: false, configurable: false});
    })();
    """#

    static var userScript: WKUserScript {
        WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
    }
}
