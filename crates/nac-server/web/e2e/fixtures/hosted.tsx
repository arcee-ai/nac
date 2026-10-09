// Test-only caller of the production native presentation; no alternate feature UI.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { createNativeRuntime, NativePresentationRoot } from "../../src/app/runtime";
import { createNacClient } from "../../src/app/services/nacClient";
import "../../src/index.css";

const configuration = (await (await fetch("/fixture-config")).json()) as { sessionId: string };
function openRuntime(release: string) {
  return createNativeRuntime({
    scope: {
      owner: "fixture-owner",
      profile: "fixture-profile",
      organization: "fixture-org",
      host: "fixture-host",
      incarnation: "fixture-incarnation",
      endpoint: "/fixture-runtime",
      release,
    },
    client: createNacClient({
      endpoint: "/fixture-runtime",
      credentials: "omit",
      headers: () => ({ "X-Fixture-Auth": "fixture-only" }),
    }),
    eventSource: (url, init, context) => {
      if (context.headers["x-fixture-auth"] !== "fixture-only")
        throw new Error("missing caller stream context");
      // The fixture server supplies a local test cookie to native EventSource.
      return new EventSource(url, init);
    },
  });
}
function HostedFixture() {
  const [runtime, setRuntime] = useState(() => openRuntime("first"));
  return (
    <>
      <nav aria-label="Fixture controls">
        <button
          onClick={() => {
            runtime.close();
            setRuntime(openRuntime("replacement"));
          }}
        >
          Replace runtime
        </button>
        <button onClick={() => runtime.close()}>Close runtime</button>
      </nav>
      <div style={{ height: "calc(100vh - 24px)" }}>
        <NativePresentationRoot
          runtime={runtime}
          router={(children) => (
            <MemoryRouter initialEntries={[`/session/${configuration.sessionId}/files`]}>
              {children}
            </MemoryRouter>
          )}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HostedFixture />
  </StrictMode>,
);
