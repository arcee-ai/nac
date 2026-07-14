(function () {
  "use strict";

  const { useReducer, useMemo, useEffect, useRef, useCallback, createElement } =
    window.React;
  const { createRoot } = window.ReactDOM;
  const html = window.htm.bind(createElement);
  const parseHtml = window.HTMLReactParser;
  const domToReact = parseHtml.domToReact;
  const attributesToProps = parseHtml.attributesToProps;

  // Same-origin when served by nac-web; otherwise talk to the local API (CORS is
  // permissive on nac-web, so the static-served PoC can reach it cross-origin).
  const API_BASE = window.location.port === "3210" ? "" : "http://127.0.0.1:3210";

  // Turn parsed <a> nodes into real React <a> elements with hardened, opener-safe
  // attributes instead of leaking raw href-only markup. Everything else keeps the
  // default string -> React node conversion.
  const parseOptions = {
    replace(node) {
      if (node && node.type === "tag" && node.name === "a") {
        const props = attributesToProps(node.attribs || {});
        props.target = "_blank";
        props.rel = "noopener noreferrer nofollow";
        return createElement(
          "a",
          props,
          domToReact(node.children || [], parseOptions),
        );
      }
      return undefined;
    },
  };

  // --- Converter chain (all buildless, vendored UMD): ------------------------
  // markdown-it -> highlight.js (fenced code) -> DOMPurify (sanitize) ->
  // html-react-parser (HTML string -> real React nodes, no dangerouslySetInnerHTML).
  const MARKDOWN_ALLOWED_TAGS = [
    "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5",
    "h6", "hr", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody",
    "td", "th", "thead", "tr", "ul",
  ];
  const MARKDOWN_ALLOWED_ATTR = ["class", "href", "rel", "start", "target"];
  const MARKDOWN_FORBID_TAGS = [
    "base", "button", "embed", "form", "iframe", "img", "input", "link", "math",
    "meta", "object", "script", "select", "style", "svg", "textarea",
  ];
  const MARKDOWN_FORBID_ATTR = ["id", "name", "src", "srcdoc", "style"];

  const md = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    highlight(str, lang) {
      const hljs = window.hljs;
      if (lang && hljs && hljs.getLanguage(lang)) {
        try {
          return (
            '<pre><code class="hljs">' +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            "</code></pre>"
          );
        } catch (_) {}
      }
      return '<pre><code class="hljs">' + md.utils.escapeHtml(str) + "</code></pre>";
    },
  });

  function renderMarkdown(source) {
    const rawHtml = md.render(source || "");
    const clean = window.DOMPurify.sanitize(rawHtml, {
      ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
      ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
      FORBID_ATTR: MARKDOWN_FORBID_ATTR,
      FORBID_TAGS: MARKDOWN_FORBID_TAGS,
    });
    return parseHtml(clean, parseOptions);
  }

  // --- Sample transcript (no live API / key needed for the render PoC) --------
  const SEED_MESSAGES = [
    {
      id: "m-sys",
      role: "system",
      content: "You are **nac**, an autonomous coding agent. Keep answers concise.",
    },
    {
      id: "m-user-1",
      role: "user",
      content: "Podsumuj, jak działa reconciliation w tym PoC i pokaż przykład kodu.",
    },
    {
      id: "m-assistant-1",
      role: "assistant",
      content: [
        "## Reconciliation w skrócie",
        "",
        "Zamiast pełnego `replaceChildren()` na każdą klatkę, React **diffuje** wirtualne drzewo i dotyka tylko tego, co się zmieniło. Wiersze są `key`-owane po `id`, więc dopisanie tokenu do jednej wiadomości nie przerysowuje reszty.",
        "",
        "- brak layout-thrashingu na całej liście",
        "- zachowany scroll i zaznaczenie tekstu",
        "- markdown liczony przez `useMemo`, tylko gdy zmieni się treść",
        "",
        "```js",
        "const nodes = useMemo(() => renderMarkdown(content), [content]);",
        "// markdown-it -> highlight.js -> DOMPurify -> html-react-parser",
        "return html`<div class=\"message-body markdown\">${nodes}</div>`;",
        "```",
        "",
        "> Dzięki temu „smooth chat” to efekt uboczny modelu komponentów, a nie ręcznej optymalizacji.",
        "",
        "Więcej: [React.createElement](https://react.dev/reference/react/createElement) oraz https://github.com/developit/htm",
      ].join("\n"),
    },
  ];

  const STREAM_SCRIPT = [
    "## Strumieniowanie na żywo\n\n",
    "Ten akapit **dopisuje się** token po tokenie. ",
    "Zwróć uwagę, że reszta transkryptu ani drgnie — ",
    "aktualizuje się wyłącznie ten jeden wiersz.\n\n",
    "Kroki potoku:\n\n",
    "1. sklej deltę z buforem\n",
    "2. `markdown-it` -> HTML\n",
    "3. `highlight.js` koloruje bloki kodu\n",
    "4. `DOMPurify` czyści\n",
    "5. `html-react-parser` -> węzły React\n\n",
    "```rust\n",
    "fn stream(mut rx: Receiver<Delta>) {\n",
    "    while let Some(delta) = rx.recv().await {\n",
    "        buffer.push_str(&delta.text);\n",
    "    }\n",
    "}\n",
    "```\n\n",
    "Gotowe — bez migotania. ",
  ];

  // Map the server snapshot (types::Message enum, tag = "role") into flat view rows.
  function mapSnapshotMessages(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((m, i) => {
      const role = m.role || "assistant";
      let content = typeof m.content === "string" ? m.content : "";
      if (role === "assistant" && !content && m.tool_calls) {
        const names = (m.tool_calls || [])
          .map((c) => (c.function && c.function.name) || "tool")
          .join(", ");
        content = "_(wywołanie narzędzi: " + names + ")_";
      }
      if (role === "tool") {
        content = "```\n" + content + "\n```";
      }
      return { id: role + "-" + i, role, content };
    });
  }

  function reducer(state, action) {
    switch (action.type) {
      case "append": {
        const messages = state.messages.map((m) =>
          m.id === action.id ? { ...m, content: m.content + action.chunk } : m,
        );
        return { ...state, messages };
      }
      case "startStream": {
        if (state.messages.some((m) => m.id === "m-stream")) return state;
        return {
          ...state,
          streaming: true,
          messages: [
            ...state.messages,
            { id: "m-stream", role: "assistant", content: "" },
          ],
        };
      }
      case "endStream":
        return { ...state, streaming: false };
      case "setSessions":
        return { ...state, sessions: action.sessions };
      case "loading":
        return { ...state, loading: action.loading, error: null };
      case "error":
        return { ...state, loading: false, error: action.error };
      case "setSnapshot":
        return {
          ...state,
          loading: false,
          error: null,
          source: "live",
          sessionId: action.sessionId,
          messages: action.messages,
        };
      case "reset":
        return { ...state, source: "demo", messages: SEED_MESSAGES, streaming: false };
      default:
        return state;
    }
  }

  function MessageBody({ content }) {
    const nodes = useMemo(() => renderMarkdown(content), [content]);
    return html`<div class="message-body markdown">${nodes}</div>`;
  }

  function MessageRow({ message, streaming }) {
    const isStreaming = streaming && message.id === "m-stream";
    return html`
      <div class="message-row">
        <div class="message-meta">
          <div class="message-meta-left">
            <span class="message-role ${message.role}">${message.role}</span>
          </div>
        </div>
        <${MessageBody} content=${message.content} />
        ${isStreaming ? html`<span class="stream-caret"></span>` : null}
      </div>
    `;
  }

  function App() {
    const [state, dispatch] = useReducer(reducer, {
      messages: SEED_MESSAGES,
      streaming: false,
      sessions: [],
      sessionId: "",
      source: "demo",
      loading: false,
      error: null,
    });
    const scrollRef = useRef(null);
    const timerRef = useRef(null);
    const selectRef = useRef(null);

    useEffect(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [state.messages]);

    useEffect(() => {
      let alive = true;
      fetch(API_BASE + "/sessions")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((list) => {
          const sessions = (Array.isArray(list) ? list : []).map((x) => x.summary || x);
          if (alive) dispatch({ type: "setSessions", sessions });
        })
        .catch((e) => alive && dispatch({ type: "error", error: "Lista sesji: " + e.message }));
      return () => {
        alive = false;
      };
    }, []);

    const loadSnapshot = useCallback(() => {
      const id = selectRef.current && selectRef.current.value;
      if (!id) return;
      dispatch({ type: "loading", loading: true });
      fetch(API_BASE + "/sessions/" + encodeURIComponent(id))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((snap) =>
          dispatch({
            type: "setSnapshot",
            sessionId: id,
            messages: mapSnapshotMessages(snap && snap.messages),
          }),
        )
        .catch((e) => dispatch({ type: "error", error: "Snapshot: " + e.message }));
    }, []);

    const startStream = useCallback(() => {
      dispatch({ type: "startStream" });
      let i = 0;
      timerRef.current = window.setInterval(() => {
        if (i >= STREAM_SCRIPT.length) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
          dispatch({ type: "endStream" });
          return;
        }
        dispatch({ type: "append", id: "m-stream", chunk: STREAM_SCRIPT[i] });
        i += 1;
      }, 90);
    }, []);

    useEffect(() => () => timerRef.current && window.clearInterval(timerRef.current), []);

    const reset = useCallback(() => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      dispatch({ type: "reset" });
    }, []);

    return html`
      <div class="poc-shell">
        <div class="poc-banner">
          <span class="poc-badge">React + htm</span>
          <span class="poc-note">
            markdown-it → highlight.js → DOMPurify → html-react-parser · no JSX · no build · no Node
          </span>
        </div>
        <div class="poc-toolbar">
          <select class="poc-select" ref=${selectRef} disabled=${state.streaming || state.sessions.length === 0}>
            ${state.sessions.length === 0
              ? html`<option value="">— brak sesji —</option>`
              : state.sessions.map(
                  (s) => html`<option value=${s.session_id} key=${s.session_id}>
                    ${(s.title || s.last_user_prompt || s.session_id).slice(0, 48)} · ${s.visible_message_count ?? 0} msg
                  </option>`,
                )}
          </select>
          <button class="poc-btn" onClick=${loadSnapshot} disabled=${state.streaming || state.loading || state.sessions.length === 0}>
            ${state.loading ? "Wczytywanie…" : "Wczytaj sesję z API"}
          </button>
          <button
            class="poc-btn"
            onClick=${startStream}
            disabled=${state.streaming}
          >
            ${state.streaming ? "Streaming…" : "Symuluj streaming"}
          </button>
          <button class="poc-btn" onClick=${reset} disabled=${state.streaming}>
            Reset (demo)
          </button>
        </div>
        ${state.error ? html`<div class="poc-error">${state.error}</div>` : null}
        <div class="poc-source">
          ${state.source === "live"
            ? html`Źródło: <b>API</b> · sesja <code>${(state.sessionId || "").slice(0, 8)}</code> · ${state.messages.length} wiadomości`
            : html`Źródło: <b>dane demo</b> (statyczne)`}
        </div>
        <div class="panel transcript" ref=${scrollRef}>
          ${state.messages.map(
            (m) => html`<${MessageRow} key=${m.id} message=${m} streaming=${state.streaming} />`,
          )}
        </div>
      </div>
    `;
  }

  const root = createRoot(document.getElementById("reactRoot"));
  root.render(html`<${App} />`);
})();
