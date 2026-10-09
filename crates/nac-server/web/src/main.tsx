import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createNativeRuntime } from "./app/runtime/nativeRuntime";
import { NativePresentationRoot } from "./app/runtime/NativePresentationRoot";
import { nacClient } from "./app/services/nacClient";
import { HashRouter } from "react-router-dom";

import { ThemeProvider } from "./app/providers/ThemeProvider";
import "./index.css";

const runtime = createNativeRuntime({
  scope: {
    owner: "standalone",
    profile: "standalone",
    organization: "standalone",
    host: "standalone",
    incarnation: "standalone",
    endpoint: "",
    release: "standalone",
  },
  client: nacClient,
  storage: localStorage,
  queryRetry: 1,
});

// Alt-click jumps from a rendered element to its source. The import is dynamic
// and guarded so the tool never reaches the committed production bundle; the
// data attributes it reads are stamped by the Babel plugin the dev server adds.
if (import.meta.env.DEV) {
  void import("@locator/runtime").then(({ default: setupLocatorUI }) => {
    setupLocatorUI({
      // React 19 has no fiber `_debugSource`; force the data-attribute adapter.
      adapter: "jsx",
      // Prefer Cursor so Alt-click / copied links open with `:line:column`.
      targets: {
        cursor: {
          url: "cursor://file${projectPath}${filePath}:${line}:${column}",
          label: "Cursor",
        },
        vscode: {
          url: "vscode://file${projectPath}${filePath}:${line}:${column}",
          label: "VSCode",
        },
      },
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativePresentationRoot
      runtime={runtime}
      globalKeyboard
      router={(children) => <HashRouter>{children}</HashRouter>}
      theme={(children) => <ThemeProvider>{children}</ThemeProvider>}
    />
  </StrictMode>,
);
