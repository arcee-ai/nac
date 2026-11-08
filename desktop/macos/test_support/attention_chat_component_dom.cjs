// Actual React component structure with inert runtime/query/model providers.
// This bypasses lazy loading and non-chat chrome; it does not prove WK paint.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ROOT = path.resolve(__dirname, "../../.."),
  web = path.join(ROOT, "crates/nac-server/web");
const req = require("node:module").createRequire(path.join(web, "package.json"));
const ts = req("typescript"),
  React = req("react"),
  { renderToStaticMarkup } = req("react-dom/server");
function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}
const routeModule = { exports: {} };
vm.runInNewContext(transpile(path.join(web, "src/app/lib/routes.ts")), {
  exports: routeModule.exports,
  module: routeModule,
});
async function productMarkup(expected, { readOnly = false } = {}) {
  const M = expected.user;
  const ReactMarkdown = (await import(req.resolve("react-markdown"))).default;
  const snapshot = {
    metadata: { behavior: "direct", model: "fixture", backend: "fixture" },
    lineage: readOnly ? { parent_session_id: "parent", kind: "child" } : null,
    active_run: null,
    forks: [],
    shell_commands: [],
    terminal_selection_attributions: [],
    message_page: { start: 0 },
  };
  const turns = [
    { kind: "user", key: "u", text: M, pending: false, messageIndex: 1 },
    {
      kind: "model",
      key: "m",
      blocks: [{ kind: "text", key: "text", text: M }],
      durationMs: 2,
      messageIndex: 2,
    },
  ];
  const model = {
    turns,
    baseTurns: turns,
    running: false,
    optimisticPrompt: null,
    submitted: null,
    showPending: false,
    replyKey: "m",
  };
  const noop = () => {},
    emptyHook = () => null;
  const layout = new Proxy(
    {
      useSidePanelCollapsed: () => true,
      useSidePanelExpanded: () => false,
      useSidePanelAnimate: () => false,
    },
    { get: (o, k) => o[k] || emptyHook },
  );
  const draftStore = {
    useDraft: () => ({ text: "" }),
    useRetentionLimited: () => false,
    useSubmitting: () => false,
    useUnreviewed: () => [],
    useRecoveries: () => [],
  };
  const runtime = {
    stores: {
      promptDraftStore: draftStore,
      composerStore: {
        consumePromptRequests: noop,
        consumeDraftRequests: noop,
        shellIntents: new Map(),
      },
      sessionLayoutStore: layout,
      attentionStore: { clearAttention: noop },
      sshConnectionStore: { useSshConnectionStatus: () => null, sshTargetFromSummary: () => null },
      runtimeStore: new Proxy(
        { useActivity: () => "", useCancelArmed: () => false },
        { get: (o, k) => o[k] || emptyHook },
      ),
    },
  };
  const modules = new Map();
  const pass = ({ children }) => React.createElement(React.Fragment, null, children);
  const constant = new Proxy({}, { get: (_, k) => String(k) });
  const atoms = new Proxy(
    {
      Modal: () => null,
      Button: () => null,
      CopyButton: () => null,
      Icon: () => null,
      Tooltip: pass,
      ShimmerLoader: () => null,
      ChatSessionMessage: ({ children, role }) => React.createElement("div", { role }, children),
    },
    {
      get: (o, k) =>
        o[k] ||
        (k.endsWith("Variant") ||
        k.endsWith("Size") ||
        k.endsWith("Placement") ||
        k === "IconName" ||
        k === "TooltipPosition" ||
        k === "ButtonContent"
          ? constant
          : pass),
    },
  );
  const query = new Proxy(
    {
      useSessionSnapshot: () => ({ data: snapshot }),
      useSessionSummary: () => ({
        data: { summary: { behavior: "direct", model: "fixture" }, lineage: null },
      }),
      useSessionGoal: () => ({ data: null }),
      useWorkspaceRevisions: () => ({ data: [] }),
    },
    {
      get: (o, k) =>
        o[k] || (() => ({ data: [], isPending: false, mutateAsync: async () => {}, mutate: noop })),
    },
  );
  const runtimeContext = React.createContext(runtime),
    modelContext = React.createContext(model);

  const actual = [
    "components/pages/SessionPage.tsx",
    "components/inspector/Transcript.tsx",
    "components/inspector/UserMessage.tsx",
    "components/inspector/ModelMessage.tsx",
    "lib/routes.ts",
  ];
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const m = { exports: {} };
    modules.set(file, m);
    const local = (id) => {
      if (id === "react" || id === "react/jsx-runtime" || id === "react-router-dom") return req(id);
      if (id === "@/app/atoms") return atoms;
      if (id === "@/app/services/queries") return query;
      if (id === "@/app/runtime/RuntimeContext")
        return { useNativeRuntime: () => React.useContext(runtimeContext) };
      if (id.includes("TranscriptModelContext"))
        return { useTranscriptModelContext: () => React.useContext(modelContext) };
      if (id.endsWith("/TranscriptModelProvider"))
        return {
          TranscriptModelProvider: ({ children }) =>
            React.createElement(modelContext.Provider, { value: model }, children),
        };
      if (id.endsWith("/ChatInputBox"))
        return load(path.join(web, "src/app/components/inspector/ChatInputBox.tsx"));
      const suffix = id.replace("@/app/", "");
      if (actual.includes(suffix + ".tsx")) return load(path.join(web, "src/app", suffix + ".tsx"));
      if (id === "@/app/lib/routes") return routeModule.exports;
      if (id.endsWith("/human-shell/queries"))
        return { useSubmitShellCommand: () => ({ isPending: false }) };
      if (id.endsWith("/presentationLifetime"))
        return { useShellPresentation: () => ({ current: null }) };
      if (id.endsWith("/usePromptHistoryPreview"))
        return { usePromptHistoryPreview: () => ({ active: false, reset: noop }) };
      if (id.endsWith("/skillReferences"))
        return { skillReferenceQuery: () => null, skillReferenceSegments: () => [] };
      if (id.endsWith("/format"))
        return {
          runMetrics: () => ({ model: "fixture", usage: null }),
          tokenUsage: () => ({}),
          sessionEnvLabel: () => "",
          ENV_SSH: "ssh",
        };
      if (id.endsWith("/ComposerFrame"))
        return load(path.join(web, "src/app/components/inspector/composer/ComposerFrame.tsx"));
      if (id.endsWith("/markdown"))
        return {
          Markdown: ({ children }) =>
            React.createElement("div", null, React.createElement(ReactMarkdown, null, children)),
        };
      if (id.endsWith("/segments"))
        return {
          partitionModelTurn: (turn) => turn.blocks.map((block) => ({ kind: "text", block })),
        };
      if (id.endsWith("/transcriptTurns"))
        return { usePreviousTurn: () => turns[0], usePromptCreatedAt: () => null };
      if (id.endsWith("/messageDate")) return { formatMessageDate: () => null };
      if (id.endsWith("/transcript")) return { RUN_CANCELLED_MARKER: "__cancelled__" };
      if (id.endsWith("/revisions")) return { revisionsByTurn: () => new Map() };
      if (id.endsWith("/cn"))
        return { cn: (...args) => args.filter((x) => typeof x === "string").join(" ") };
      if (id.endsWith("/sessionBehavior"))
        return {
          sessionPanelPolicy: () => ({
            mobilePanels: ["insights"],
            widePanels: ["insights"],
            defaultPanel: "insights",
          }),
        };
      if (id.endsWith("/policy")) return { sessionAvailable: () => true };
      if (id.endsWith("/useMediaQuery")) return { useIsMobile: () => false };
      if (id.endsWith("/visibility")) return { useDesktopVisible: () => true };
      if (id.endsWith("/useTranscriptReveal")) return { useTranscriptReveal: () => true };
      if (id.endsWith("/useStickToBottom"))
        return {
          useStickToBottom: () => ({
            scrollRef: React.createRef(),
            contentRef: React.createRef(),
            showJumpButton: false,
          }),
        };
      if (id.endsWith("/useInsightsNavigation"))
        return { useInsightsNavigation: () => ({ openThread: noop }) };
      if (id.endsWith("/useErrorNotice")) return { useErrorNotice: () => () => null };
      if (id.endsWith("/useAuthErrorSuppressed")) return { useAuthErrorSuppressed: () => false };
      if (id.endsWith("/UiPolicyContext")) return { useUiPolicy: () => ({}) };
      if (id.endsWith("/ProjectActionsProvider")) return { useProjectActions: () => ({}) };
      if (id.endsWith("/ToastProvider")) return { useToast: () => ({ error: noop }) };
      if (id.endsWith("/SessionActionsProvider")) return { useSessionActions: () => ({}) };
      if (id.endsWith("/TopSingleSessionHeader"))
        return {
          TopSingleSessionHeader: () =>
            React.createElement("header", null, React.createElement("p", null, M)),
        };
      return new Proxy(
        {},
        {
          get: (_, key) =>
            key.startsWith("use")
              ? noop
              : key.endsWith("Provider") || key === "PerfProfiler"
                ? pass
                : () => null,
        },
      );
    };
    vm.runInNewContext(
      transpile(file),
      { module: m, exports: m.exports, require: local, console },
      { filename: file },
    );
    return m.exports;
  }
  const SessionPage = load(path.join(web, "src/app/components/pages/SessionPage.tsx")).default;
  const { MemoryRouter, Routes, Route } = req("react-router-dom");
  return renderToStaticMarkup(
    React.createElement(
      runtimeContext.Provider,
      { value: runtime },
      React.createElement(
        MemoryRouter,
        { initialEntries: [expected.route] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/session/:sessionId/:panel",
            element: React.createElement(SessionPage),
          }),
        ),
      ),
    ),
  );
}
module.exports = { productMarkup };
