// Test-only caller of the production native presentation; no alternate feature UI.
import { SessionNameSurfaces } from "./session-name-surfaces";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { createNativeRuntime, NativePresentationRoot } from "../../src/app/runtime";
import { createNacClient } from "../../src/app/services/nacClient";
import "../../src/index.css";

const configuration = (await (await fetch("/fixture-config")).json()) as {
  sessionId: string;
  twoInstances: boolean;
  nameSurfaces: boolean;
};
function openRuntime(release: string, instance: string) {
  return createNativeRuntime({
    scope: {
      owner: "fixture-owner",
      profile: instance === "single" ? "fixture-profile" : `fixture-profile-${instance}`,
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
function HostedFixture({ instance = "single" }: { instance?: string }) {
  const [runtime, setRuntime] = useState(() => openRuntime("first", instance));
  return (
    <>
      <nav aria-label="Fixture controls">
        <button
          onClick={() => {
            runtime.close();
            setRuntime(openRuntime("replacement", instance));
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
              {configuration.nameSurfaces ? <SessionNameSurfaces /> : children}
            </MemoryRouter>
          )}
        />
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {configuration.twoInstances ? (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {["Left", "Right"].map((name) => (
          <section key={name} aria-label={`${name} presentation`} style={{ minWidth: 0 }}>
            <HostedFixture instance={name.toLowerCase()} />
          </section>
        ))}
      </div>
    ) : (
      <HostedFixture />
    )}
  </StrictMode>,
);
