/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createNacClient } from "@/app/services/nacClient";
import { createNativeRuntime } from "@/app/runtime/nativeRuntime";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import type {
  ProductContext,
  ProductDestination,
  ProductNavigationResolution,
} from "@/app/types/api";
import { ProductNavigationProvider } from "./ProductNavigationProvider";
import { useProductNavigationOwner } from "./context";

const state = vi.hoisted(() => ({ mobile: false, known: true }));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/app/services/queries", () => ({
  useSessionSummary: () => ({
    data: state.known
      ? { summary: { session_id: "session", behavior: "direct" }, lineage: null }
      : undefined,
  }),
  useSessionSnapshot: (_: string | null, options: { enabled?: boolean }) => {
    expect(options.enabled).toBe(false);
    return { data: state.known ? { lineage: null } : undefined };
  },
}));
vi.mock("@/app/components/modals/ConfigurationsModal", () => ({
  ConfigurationsModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Configurations" /> : null,
}));
vi.mock("@/app/components/modals/MCPServersModal/McpServersModal", () => ({
  McpServersModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="MCP servers" /> : null,
}));
vi.mock("@/app/components/modals/SshConfigsModal", () => ({
  SshConfigsModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="SSH configurations" /> : null,
}));
vi.mock("@/app/atoms", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "aria-label": label,
  }: {
    children: ReactNode;
    onClick(): void;
    disabled: boolean;
    "aria-label": string;
  }) => (
    <button disabled={disabled} onClick={onClick} aria-label={label}>
      {children}
    </button>
  ),
  ButtonSize: { Large: "large" },
  ButtonVariant: { Secondary: "secondary" },
  ModalSize: { Medium: "medium" },
  Modal: ({ open, children, title }: { open: boolean; children: ReactNode; title: string }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));
const build = {
  product_version: "1.0.0",
  build_id: "build",
  track: "dev",
  source_revision: "revision",
};
const context: ProductContext = {
  schema_version: 1,
  build,
  source: "installed-runtime",
  managed: false,
  features: [],
  session: null,
  mcp: { availability: "disabled", count: 0 },
  destinations: [
    {
      destination: "mcp-settings",
      label: "MCP settings",
      availability: "available",
      steps: "Open MCP.",
    },
  ],
};
const opened: ReturnType<typeof createNativeRuntime>[] = [];
afterEach(() => {
  cleanup();
  for (const runtime of opened.splice(0)) runtime.close();
});
beforeEach(() => {
  state.mobile = false;
  state.known = true;
});
function Probe() {
  const owner = useProductNavigationOwner();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="route">{location.pathname}</p>
      <button onClick={owner.inspect}>Inspect</button>
      <button onClick={owner.openMcp}>Sidebar MCP</button>
      <button onClick={() => navigate("/session/other/insights")}>Switch chat</button>
    </>
  );
}
function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (String(url).includes("product-context")) return Response.json(context);
    const request = JSON.parse(String(init?.body));
    return Response.json({
      build,
      session_id: request.session_id,
      target: {
        destination: request.destination,
        label: request.destination,
        availability: "available",
        steps: "Use the existing UI.",
      },
      opened: false,
    });
  });
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "standalone",
      organization: "org",
      host: "host",
      incarnation: "incarnation",
      endpoint: "/runtime",
      release: "release",
    },
    client: createNacClient({ endpoint: "/runtime", fetch }),
  });
  opened.push(runtime);
  const view = render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <MemoryRouter initialEntries={["/session/session/insights"]}>
          <ProductNavigationProvider>
            <Probe />
          </ProductNavigationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  const open = async (destination: ProductDestination) => {
    let result!: ProductNavigationResolution;
    await act(async () => {
      result = await runtime.productNavigation.open({
        destination,
        expected_build_id: "build",
        session_id: "session",
      });
    });
    return result;
  };
  return { ...view, runtime, fetch, open };
}
it("reads/renders facts without navigation, then opens the same MCP dialog as the sidebar", async () => {
  const { fetch } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  await screen.findByText("installed-runtime");
  expect(screen.queryByRole("dialog", { name: "MCP servers" })).toBeNull();
  expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Open MCP settings" }));
  await screen.findByRole("dialog", { name: "MCP servers" });
  expect(screen.queryByRole("dialog", { name: "NAC capabilities" })).toBeNull();
  expect(screen.getByTestId("route").textContent).toBe("/session/session/insights");
});
it.each([
  ["mcp-settings", "MCP servers"],
  ["configurations", "Configurations"],
  ["model-authentication", "Configurations"],
  ["ssh-configurations", "SSH configurations"],
] as const)("opens %s through its existing dialog", async (destination, label) => {
  const { open } = fixture();
  expect((await open(destination)).opened).toBe(true);
  expect(screen.getByRole("dialog", { name: label })).toBeTruthy();
});
it.each([
  ["session-subagents", "delegated"],
  ["session-files", "files"],
  ["session-terminal", "terminal"],
] as const)("shows the current session's %s panel", async (destination, panel) => {
  const { open, runtime } = fixture();
  expect((await open(destination)).opened).toBe(true);
  expect(screen.getByTestId("route").textContent).toBe(`/session/session/${panel}`);
  expect(runtime.productNavigation).toBeDefined();
});
it("opens Projects and gives a truthful History fallback on desktop", async () => {
  const { open } = fixture();
  expect((await open("session-history")).opened).toBe(false);
  expect(screen.getByTestId("route").textContent).toBe("/session/session/insights");
  expect((await open("projects")).opened).toBe(true);
  expect(screen.getByTestId("route").textContent).toBe("/");
});
it("opens History on phones without selecting a different session", async () => {
  state.mobile = true;
  const { open } = fixture();
  expect((await open("session-history")).opened).toBe(true);
  expect(screen.getByTestId("route").textContent).toBe("/session/session/history");
});
it("does not attach or navigate for an unavailable current session", async () => {
  state.known = false;
  const { open, fetch } = fixture();
  expect((await open("session-files")).opened).toBe(false);
  expect(screen.getByTestId("route").textContent).toBe("/session/session/insights");
  expect(fetch.mock.calls).toHaveLength(1);
  expect(String(fetch.mock.calls[0]?.[0])).toContain("/product-destinations/resolve");
});

it("hides cached facts and destinations when a replacement serving incarnation rejects the read", async () => {
  const { fetch } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  await screen.findByText("installed-runtime");
  fireEvent.click(screen.getByRole("button", { name: "Sidebar MCP" }));
  fetch.mockResolvedValueOnce(
    Response.json({ error: "Product context unavailable; presentation changed" }, { status: 404 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Reload this app");
  expect(screen.queryByText("installed-runtime")).toBeNull();
  expect(screen.queryByRole("button", { name: "Open MCP settings" })).toBeNull();
});
