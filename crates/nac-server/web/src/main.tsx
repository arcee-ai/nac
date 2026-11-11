import { readDesktopCommandPort } from "./app/features/desktop-commands/adapter";
import { desktopReadFetch, installDesktopLifetime } from "./app/features/desktop-commands/lifetime";
import { openDesktopStorage, safeStorage } from "./app/features/desktop-storage/adapter";
import { StorageNotice } from "./app/features/desktop-storage/StorageNotice";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createNativeRuntime } from "./app/runtime/nativeRuntime";
import { NativePresentationRoot } from "./app/runtime/NativePresentationRoot";
import { readStandaloneScope } from "./app/runtime/standaloneScope";
import { createNacClient } from "./app/services/nacClient";
import { HashRouter } from "react-router-dom";

import { ThemeProvider } from "./app/providers/ThemeProvider";
import "./index.css";

const desktopCommands = readDesktopCommandPort(Reflect.get(window, "__nacDesktop"));
const client = createNacClient({
  endpoint: location.origin,
  credentials: "same-origin",
  fetch: desktopReadFetch(desktopCommands, globalThis.fetch.bind(globalThis)),
});
const scope = readStandaloneScope(document, client.transport.endpoint);

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

async function start() {
  let capability: unknown;
  try {
    capability = Reflect.get(window, "__nacDesktopStorage");
  } catch {
    capability = null;
  }
  const storage = await openDesktopStorage(capability, client.transport.endpoint);
  const runtime = createNativeRuntime({
    scope: scope ?? {
      owner: "standalone",
      profile: "standalone",
      organization: "standalone",
      host: "standalone",
      incarnation: "standalone",
      endpoint: client.transport.endpoint,
      release: "standalone",
    },
    client,
    standaloneServingIncarnation: scope?.incarnation,
    storage: storage?.preferences ?? safeStorage(window, "localStorage"),
    draftStorage: scope ? (storage?.drafts ?? safeStorage(window, "sessionStorage")) : undefined,
    draftPersistenceBinding: scope ? storage?.binding : undefined,
    // Native same-engine recovery restricts input after storage hydration.
    requireTerminalAcknowledgement:
      !!desktopCommands && Reflect.get(window, "__nacRequireTerminalAcknowledgement") === true,
    queryRetry: 1,
  });
  const root = createRoot(document.getElementById("root")!);
  installDesktopLifetime(
    desktopCommands,
    {
      close() {
        // Fence native writes before presentation release resets any owner.
        storage?.close();
        runtime.close();
      },
    },
    () => root.unmount(),
    window,
  );
  root.render(
    <StrictMode>
      {storage ? <StorageNotice storage={storage} /> : null}
      <NativePresentationRoot
        runtime={runtime}
        desktopCommands={desktopCommands}
        globalKeyboard
        router={(children) => <HashRouter>{children}</HashRouter>}
        theme={(children) => <ThemeProvider>{children}</ThemeProvider>}
      />
    </StrictMode>,
  );
}
void start();
