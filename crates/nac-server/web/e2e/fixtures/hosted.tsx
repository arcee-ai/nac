// Test-only caller of the production native presentation; no alternate feature UI.
import { SessionNameSurfaces } from "./session-name-surfaces";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { createNativeRuntime, NativePresentationRoot } from "../../src/app/runtime";
import { createNacClient } from "../../src/app/services/nacClient";
import "../../src/index.css";

const configuration = (await (await fetch("/fixture-config")).json()) as {
  sessionId: string;
  twoInstances: boolean;
  nameSurfaces: boolean;
  preferenceStorage?: { projectId: string; otherSessionId: string };
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
    // Opt-in caller-owned preferences, not a product storage policy or draft adapter.
    storage: configuration.preferenceStorage
      ? {
          getItem: (key) => localStorage.getItem(`fixture:${instance}:${key}`),
          setItem: (key, value) => localStorage.setItem(`fixture:${instance}:${key}`, value),
        }
      : undefined,
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
  const retired = useRef<ReturnType<typeof createNativeRuntime> | null>(null);
  const [preferences, setPreferences] = useState("");
  const inspectPreferences = () =>
    setPreferences(
      JSON.stringify({
        closed: runtime.isClosed(),
        tabs: {
          dismissed: [...runtime.stores.chatTabsStore.chatTabsStore.getState().dismissed],
          order: runtime.stores.chatTabsStore.chatTabsStore.getState().order,
        },
        navigation: {
          pinned: [
            ...runtime.stores.sessionNavigationStore.sessionNavigationStore.getState().pinned,
          ],
          lastViewedAt:
            runtime.stores.sessionNavigationStore.sessionNavigationStore.getState().lastViewedAt,
        },
        stored: {
          tabs: JSON.parse(localStorage.getItem(`fixture:${instance}:nac.chatTabs`) ?? "null"),
          navigation: JSON.parse(
            localStorage.getItem(`fixture:${instance}:nac.sessionNavigation`) ?? "null",
          ),
        },
      }),
    );
  return (
    <>
      <nav aria-label="Fixture controls">
        <button
          onClick={() => {
            runtime.close();
            if (configuration.preferenceStorage) retired.current = runtime;
            setRuntime(openRuntime("replacement", instance));
          }}
        >
          Replace runtime
        </button>
        <button onClick={() => runtime.close()}>Close runtime</button>
        {configuration.preferenceStorage ? (
          <>
            {/* Test caller operations on actual production owners. These controls
              do not stand in for currently mounted product pin/tab UI. */}
            <button
              onClick={() => {
                const { projectId, otherSessionId } = configuration.preferenceStorage!;
                runtime.stores.chatTabsStore.dismissChatTab(otherSessionId);
                runtime.stores.chatTabsStore.setChatTabOrder(projectId, [
                  otherSessionId,
                  configuration.sessionId,
                ]);
                runtime.stores.sessionNavigationStore.toggleSessionNavigationPin(
                  configuration.sessionId,
                );
                runtime.stores.sessionNavigationStore.markSessionViewed(
                  configuration.sessionId,
                  "2099-01-01T00:00:00Z",
                );
              }}
            >
              Set caller preferences
            </button>
            <button onClick={inspectPreferences}>Inspect caller preferences</button>
            <button
              onClick={() => {
                const { projectId, otherSessionId } = configuration.preferenceStorage!;
                retired.current?.stores.chatTabsStore.dismissChatTab(configuration.sessionId);
                retired.current?.stores.chatTabsStore.setChatTabOrder(projectId, [
                  configuration.sessionId,
                  otherSessionId,
                ]);
                retired.current?.stores.sessionNavigationStore.toggleSessionNavigationPin(
                  otherSessionId,
                );
              }}
            >
              Mutate retired preferences
            </button>
            <output hidden aria-label="Caller preference snapshot">
              {preferences}
            </output>
          </>
        ) : null}
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
