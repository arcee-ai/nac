import { RegistryContext } from "@effect/atom-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { appAtomRegistry } from "./app/effect/registry";
import { appRuntime } from "./app/effect/runtime";
import { ThemeProvider } from "./app/providers/ThemeProvider";
import "./index.css";

// Hold the shared Effect runtime for the life of the page. API programs run
// here; React renders and subscribes through the atom registry.
void appRuntime;

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
    <RegistryContext.Provider value={appAtomRegistry}>
      <ThemeProvider>
        {/* Hash routing keeps deep links working without a server catch-all. */}
        <HashRouter>
          <App />
        </HashRouter>
      </ThemeProvider>
    </RegistryContext.Provider>
  </StrictMode>,
);
