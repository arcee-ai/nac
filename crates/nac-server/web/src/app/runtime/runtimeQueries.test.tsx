/** @vitest-environment jsdom */
import { StrictMode, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createNacClient } from "../services/nacClient";
import {
  queryKeys,
  useProjects,
  useSessions,
  useSessionGoal,
  useSessionInbox,
  useSessionPermissions,
  useTraditionalChildren,
  useWorkspaceFiles,
  useModelConfigs,
  useMcpServers,
  useStoredCredentials,
  useProviderModels,
} from "../services/queries";
import { useNativeRuntime, RuntimeContext } from "./RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "./nativeRuntime";
import { NativePresentationRoot } from "./NativePresentationRoot";

const instances: NativeRuntime[] = [];
afterEach(() => {
  cleanup();
  for (const runtime of instances.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});
function instance(name: string) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = String(input).replace(`/${name}`, "");
    if (path === "/ui-config")
      return Response.json({ orchestration_enabled: false, diagnostic: null });
    if (path === "/projects") return Response.json({ projects: [] });
    if (path.startsWith("/sessions?") || path === "/sessions") return Response.json([]);
    if (path === "/managed/status") return Response.json({ error: "unmanaged" }, { status: 404 });
    return Response.json({
      source: name,
      servers: [],
      configurations: [],
      providers: [],
      credentials: [],
    });
  });
  const runtime = createNativeRuntime({
    scope: {
      owner: name,
      profile: name,
      organization: name,
      host: name,
      incarnation: name,
      endpoint: `/${name}`,
      release: name,
    },
    client: createNacClient({ endpoint: `/${name}`, fetch }),
  });
  instances.push(runtime);
  return { runtime, fetch };
}
function QueryOwners() {
  const { stores } = useNativeRuntime();
  const projects = useProjects();
  const sessions = useSessions();
  const goal = useSessionGoal("same", true);
  const inbox = useSessionInbox("same", true);
  const permissions = useSessionPermissions("same", true);
  const children = useTraditionalChildren("same", true);
  const files = useWorkspaceFiles("same");
  const models = useModelConfigs();
  const mcp = useMcpServers();
  const credentials = useStoredCredentials();
  const queries = [
    projects,
    sessions,
    goal,
    inbox,
    permissions,
    children,
    files,
    models,
    mcp,
    credentials,
  ];
  return (
    <>
      <output>{queries.filter((query) => query.isSuccess).length}</output>
      <button onClick={() => stores.composerStore.sendPrompt("runtime-owned")}>Draft</button>
    </>
  );
}
function Wrapper({ runtime, children }: { runtime: NativeRuntime; children: ReactNode }) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

it("binds representative native query owners to private instances without global API reads", async () => {
  const left = instance("left");
  const right = instance("right");
  const first = render(
    <Wrapper runtime={left.runtime}>
      <QueryOwners />
    </Wrapper>,
  );
  const second = render(
    <Wrapper runtime={right.runtime}>
      <QueryOwners />
    </Wrapper>,
  );
  await waitFor(() => {
    expect(first.container.querySelector("output")?.textContent).toBe("10");
    expect(second.container.querySelector("output")?.textContent).toBe("10");
  });
  expect(left.fetch.mock.calls.every(([url]) => String(url).startsWith("/left/"))).toBe(true);
  expect(right.fetch.mock.calls.every(([url]) => String(url).startsWith("/right/"))).toBe(true);
  expect(left.runtime.queryClient.getQueryData(queryKeys.sessionGoal("same"))).toMatchObject({
    source: "left",
  });
  expect(right.runtime.queryClient.getQueryData(queryKeys.sessionGoal("same"))).toMatchObject({
    source: "right",
  });
  await act(async () => left.runtime.close());
  expect(left.runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(right.runtime.queryClient.getQueryData(queryKeys.sessionGoal("same"))).toMatchObject({
    source: "right",
  });
});

it("mounts the real presentation under caller routing, keeps overlays local and releases replaced roots", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const original = instance("first");
  const next = instance("next");
  const url = window.location.href;
  const outerTheme = document.documentElement.getAttribute("data-theme");
  const router = (children: ReactNode) => <MemoryRouter>{children}</MemoryRouter>;
  const mounted = render(
    <StrictMode>
      <NativePresentationRoot runtime={original.runtime} router={router} />
    </StrictMode>,
  );
  await waitFor(() => expect(mounted.getByText("No projects yet")).toBeDefined());
  expect(original.runtime.isClosed()).toBe(false);
  const boundary = mounted.container.querySelector("[data-nac-runtime]");
  expect(boundary?.classList.contains("dark")).toBe(true);
  expect(boundary?.getAttribute("data-theme")).toBe("dark");
  fireEvent.click(mounted.getByRole("button", { name: /Get Started/i }));
  await waitFor(() => expect(mounted.getByRole("dialog")).toBeDefined());
  expect(mounted.getByRole("dialog").closest("[data-nac-overlays]")).not.toBeNull();
  expect(mounted.getByRole("dialog").closest(".dark")).toBe(boundary);
  expect(mounted.container.querySelector("[data-nac-content]")?.hasAttribute("inert")).toBe(true);
  expect(mounted.container.firstElementChild?.hasAttribute("inert")).toBe(false);
  expect(window.location.href).toBe(url);
  expect(document.documentElement.getAttribute("data-theme")).toBe(outerTheme);
  mounted.rerender(
    <StrictMode>
      <NativePresentationRoot runtime={next.runtime} router={router} />
    </StrictMode>,
  );
  await waitFor(() => {
    expect(original.runtime.isClosed()).toBe(true);
    expect(mounted.queryByRole("dialog")).toBeNull();
    expect(mounted.getByText("No projects yet")).toBeDefined();
  });
  await act(async () => next.runtime.close());
  expect(mounted.container.innerHTML).toBe("");
});

it("keeps concurrent native dialog stacks and keyboard ownership separate", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const left = instance("left");
  const right = instance("right");
  const router = (children: ReactNode) => <MemoryRouter>{children}</MemoryRouter>;
  const first = render(<NativePresentationRoot runtime={left.runtime} router={router} />);
  const second = render(<NativePresentationRoot runtime={right.runtime} router={router} />);
  const leftView = within(first.container);
  const rightView = within(second.container);
  await waitFor(() => {
    expect(leftView.getByText("No projects yet")).toBeDefined();
    expect(rightView.getByText("No projects yet")).toBeDefined();
  });
  fireEvent.click(leftView.getByRole("button", { name: /Get Started/i }));
  fireEvent.click(rightView.getByRole("button", { name: /Get Started/i }));
  fireEvent.keyDown(leftView.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(leftView.queryByRole("dialog")).toBeNull());
  expect(rightView.getByRole("dialog")).toBeDefined();
  expect(second.container.querySelector("[data-nac-content]")?.hasAttribute("inert")).toBe(true);
  expect(first.container.querySelector("[data-nac-content]")?.hasAttribute("inert")).toBe(false);
});

it("keeps draft credentials out of query keys on standalone HTTP without crypto.randomUUID", async () => {
  vi.stubGlobal("crypto", {});
  const selected = instance("http");
  const hook = renderHook(({ key }) => useProviderModels("openai-responses", key, null, true), {
    initialProps: { key: "private-first" },
    wrapper: ({ children }) => <Wrapper runtime={selected.runtime}>{children}</Wrapper>,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  const initial = selected.runtime.queryClient.getQueryCache().getAll()[0].queryKey;
  hook.rerender({ key: "private-second" });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  const entries = selected.runtime.queryClient.getQueryCache().getAll();
  expect(entries).toHaveLength(2);
  expect(entries[1].queryKey).not.toEqual(initial);
  expect(JSON.stringify(entries.map((query) => query.queryKey))).not.toContain("private-");
});
