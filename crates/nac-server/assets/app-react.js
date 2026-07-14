/**
 * Proof-of-concept: the nac session dashboard rendered with React + htm.
 *
 * No Node, no build step. React, ReactDOM and htm are vendored UMD files loaded
 * via <script> tags (same approach the project already uses for markdown-it and
 * DOMPurify). JSX-like syntax comes from htm at runtime; component state and
 * reconciliation are plain runtime React.
 *
 * The app talks to the live nac-web JSON/SSE API. When this file is served from
 * nac-web itself it uses same-origin requests; when served from a separate
 * static server it targets 127.0.0.1:3210 (nac-web enables permissive CORS).
 */
(function () {
  "use strict";

  const { useReducer, useEffect, useRef, useCallback, createElement } = window.React;
  const { createRoot } = window.ReactDOM;
  const html = window.htm.bind(createElement);

  const API_BASE = window.location.port === "3210" ? "" : "http://127.0.0.1:3210";

  async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  const initialState = {
    storePath: "store path pending",
    sessions: [],
    selectedId: null,
    snapshot: null,
    events: [],
    error: "",
  };

  function reducer(state, action) {
    switch (action.type) {
      case "store":
        return { ...state, storePath: action.storePath };
      case "sessions":
        return { ...state, sessions: action.sessions };
      case "select":
        return { ...state, selectedId: action.id, snapshot: null, events: [] };
      case "snapshot":
        if (action.id !== state.selectedId) return state;
        return { ...state, snapshot: action.snapshot };
      case "event":
        if (action.id !== state.selectedId) return state;
        return { ...state, events: [...state.events, action.event].slice(-200) };
      case "resetEvents":
        return { ...state, events: [] };
      case "error":
        return { ...state, error: action.message };
      default:
        return state;
    }
  }

  function shortId(id) {
    return id ? id.slice(0, 8) : "";
  }

  function sessionTitle(summary) {
    if (summary && typeof summary.title === "string" && summary.title.trim()) {
      return summary.title.trim();
    }
    return shortId(summary && summary.session_id) || "untitled";
  }

  function SessionCard({ entry, selected, onSelect }) {
    const summary = entry.summary || {};
    const sessionId = summary.session_id || "";
    const active = Boolean(entry.active_run);
    return html`
      <article
        class=${`session-card ${selected ? "selected" : ""}`}
        role="listitem"
        title=${`Session ID: ${sessionId}`}
      >
        <button
          class="session-card-select"
          type="button"
          onClick=${() => onSelect(sessionId)}
          aria-label=${`Select ${sessionTitle(summary)}`}
        >
          <div class="session-card-head">
            <div>
              <h2>
                <span class=${`status-dot ${active ? "run" : ""}`} aria-hidden="true"></span>
                <span class="session-card-title-text">${sessionTitle(summary)}</span>
              </h2>
              <div class="cwd">${summary.cwd || ""}</div>
            </div>
          </div>
          <div class="telemetry-grid">
            <div><span>run</span><strong class=${`run-tile ${active ? "run-tile-active" : ""}`}>${active ? "active" : "idle"}</strong></div>
            <div><span>id</span><strong>${shortId(sessionId)}</strong></div>
            <div><span>ssh</span><strong>${summary.ssh_host ? "yes" : "—"}</strong></div>
          </div>
          <div class="last-prompt">${summary.last_user_prompt || "no prompt yet"}</div>
        </button>
      </article>
    `;
  }

  function Inspector({ selectedId, snapshot, events }) {
    if (!selectedId) {
      return html`
        <aside class="inspector poc-pane">
          <header class="inspector-head">
            <div>
              <div class="eyebrow">Inspector</div>
              <h1>No session selected</h1>
              <p>Select a session to load its snapshot and live events.</p>
            </div>
          </header>
        </aside>
      `;
    }

    const model = (snapshot && snapshot.snapshot_model) || "--";
    const backend = (snapshot && snapshot.snapshot_backend) || "--";
    const messageCount = snapshot && Array.isArray(snapshot.messages) ? snapshot.messages.length : 0;
    const runState = snapshot && snapshot.active_run ? "running" : "idle";

    return html`
      <aside class="inspector poc-pane">
        <header class="inspector-head">
          <div>
            <div class="eyebrow">Inspector</div>
            <h1>${shortId(selectedId)}</h1>
            <p>Live snapshot + streamed events.</p>
          </div>
        </header>
        <section class="summary-grid">
          <div><span>Model</span><strong>${model}</strong></div>
          <div><span>Backend</span><strong>${backend}</strong></div>
          <div><span>Msgs</span><strong>${messageCount}</strong></div>
          <div><span>Run</span><strong>${runState}</strong></div>
        </section>
        <h3 style=${{ margin: "12px 0 6px" }}>Events (SSE) · ${events.length}</h3>
        <div class="poc-events">
          ${events.length === 0
            ? html`<div class="poc-event">waiting for events…</div>`
            : events
                .slice()
                .reverse()
                .map(
                  (envelope, index) => html`
                    <div class="poc-event" key=${envelope.sequence_id ?? index}>
                      <b>#${envelope.sequence_id ?? "?"}</b> ${describeEvent(envelope)}
                    </div>
                  `,
                )}
        </div>
      </aside>
    `;
  }

  function describeEvent(envelope) {
    const event = (envelope && envelope.event) || {};
    const type = event.type || "event";
    const inner = event.event || {};
    const detail = inner.type || event.prompt_preview || "";
    return detail ? `${type} · ${detail}` : type;
  }

  function App() {
    const [state, dispatch] = useReducer(reducer, initialState);
    const eventSourceRef = useRef(null);

    useEffect(() => {
      let cancelled = false;
      apiGet("/store")
        .then((store) => {
          if (!cancelled) dispatch({ type: "store", storePath: store.store_path || "--" });
        })
        .catch((error) => dispatch({ type: "error", message: error.message }));

      const loadSessions = () =>
        apiGet("/sessions")
          .then((sessions) => {
            if (!cancelled) dispatch({ type: "sessions", sessions });
          })
          .catch((error) => dispatch({ type: "error", message: error.message }));

      loadSessions();
      const timer = setInterval(loadSessions, 5000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, []);

    const selectSession = useCallback((id) => {
      dispatch({ type: "select", id });
    }, []);

    useEffect(() => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (!state.selectedId) return undefined;

      const id = state.selectedId;
      apiGet(`/sessions/${encodeURIComponent(id)}`)
        .then((snapshot) => dispatch({ type: "snapshot", id, snapshot }))
        .catch((error) => dispatch({ type: "error", message: error.message }));

      const source = new EventSource(
        `${API_BASE}/sessions/${encodeURIComponent(id)}/events/stream?after_sequence_id=0`,
      );
      source.onmessage = (message) => {
        try {
          const envelope = JSON.parse(message.data);
          dispatch({ type: "event", id, event: envelope });
        } catch (_) {
          /* ignore malformed frames */
        }
      };
      eventSourceRef.current = source;

      return () => {
        source.close();
        if (eventSourceRef.current === source) eventSourceRef.current = null;
      };
    }, [state.selectedId]);

    return html`
      <div class="poc-shell">
        <header class="poc-banner top-strip">
          <div class="nac-wordmark">NAC</div>
          <span class="poc-badge">React + htm · no node · no build</span>
          <strong class="store-path" title=${state.storePath}>${state.storePath}</strong>
        </header>

        ${state.error ? html`<div class="poc-event">error: ${state.error}</div>` : null}

        <div class="poc-layout">
          <main class="board poc-pane">
            <section class="session-grid" aria-label="Sessions">
              ${state.sessions.length === 0
                ? html`<div class="poc-event">no sessions yet</div>`
                : state.sessions.map((entry) => {
                    const sessionId = (entry.summary && entry.summary.session_id) || "";
                    return html`<${SessionCard}
                      key=${sessionId}
                      entry=${entry}
                      selected=${sessionId === state.selectedId}
                      onSelect=${selectSession}
                    />`;
                  })}
            </section>
          </main>

          <${Inspector}
            selectedId=${state.selectedId}
            snapshot=${state.snapshot}
            events=${state.events}
          />
        </div>
      </div>
    `;
  }

  createRoot(document.getElementById("reactRoot")).render(html`<${App} />`);
})();
