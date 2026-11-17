/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { SettingsReturnProvider } from "./SettingsReturnProvider";

const state = vi.hoisted(() => ({ mobile: false, managed: false }));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => state.mobile,
  useMediaQuery: () => state.mobile,
}));
vi.mock("@/app/features/managed/controller/useManagedHost", () => ({
  useManagedHost: () => ({ isManaged: state.managed, status: null }),
}));
vi.mock("@/app/features/managed/queries", () => ({
  useManagedHostStatus: () => ({ isPending: false }),
}));
vi.mock("@/app/components/modals/ConfigurationsModal", () => ({
  ConfigurationsSettings: () => <p>Configurations manager</p>,
}));
vi.mock("@/app/components/modals/MCPServersModal/McpServersModal", () => ({
  McpServersSettings: () => <p>MCP manager</p>,
}));
vi.mock("@/app/components/modals/SshConfigsModal", () => ({
  SshConfigsSettings: () => <p>SSH manager</p>,
}));
vi.mock("@/app/features/managed/presentation/ManagedHostSettings", () => ({
  ManagedHostSettings: () => <p>Managed host panels</p>,
}));
vi.mock("@/app/features/product-context/ProductContextPanel", () => ({
  ProductContextPanel: ({ sessionId }: { sessionId: string | null }) => (
    <p>Capabilities for {sessionId ?? "no session"}</p>
  ),
}));
vi.mock("./sections/GeneralSection", () => ({ GeneralSection: () => <p>General overview</p> }));
vi.mock("./sections/AboutSection", () => ({ AboutSection: () => <p>About facts</p> }));
vi.mock("./sections/AppearanceSection", () => ({
  AppearanceSection: () => <p>Appearance controls</p>,
}));

beforeEach(() => {
  state.mobile = false;
  state.managed = false;
});
afterEach(cleanup);

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{`${location.pathname}${location.search}`}</output>
      <button onClick={() => navigate("/settings/mcp")}>Open settings</button>
    </>
  );
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsReturnProvider>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
        <Routes>
          <Route path="/settings/*" element={<Where />} />
          <Route path="*" element={null} />
        </Routes>
      </SettingsReturnProvider>
    </MemoryRouter>,
  );
}

const where = () => screen.getAllByTestId("where").at(-1)?.textContent;

it("shows grouped sections beside the open one and switches between them", () => {
  mount("/settings/general");
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  const labels = within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent);
  expect(labels).toEqual([
    "General",
    "Appearance",
    "Models & providers",
    "MCP servers",
    "Capabilities",
    "SSH hosts",
    "Shortcuts",
    "About",
  ]);
  expect(within(nav).getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
  fireEvent.click(within(nav).getByRole("link", { name: "MCP servers" }));
  expect(screen.getByText("MCP manager")).toBeTruthy();
  expect(screen.getByRole("main", { name: "MCP servers" })).toBeTruthy();
});

it("lists and opens Managed host only on a managed host", () => {
  mount("/settings/managed");
  expect(where()).toBe("/settings/general");
  expect(screen.queryByRole("link", { name: "Managed host" })).toBeNull();
  cleanup();

  state.managed = true;
  mount("/settings/managed");
  expect(screen.getByRole("link", { name: "Managed host" })).toBeTruthy();
  expect(screen.getByText("Managed host panels")).toBeTruthy();
});

it("redirects an unknown section and the bare path to General on desktop", () => {
  mount("/settings/nope");
  expect(where()).toBe("/settings/general");
  cleanup();
  mount("/settings");
  expect(where()).toBe("/settings/general");
});

it("filters sections by their names and rows", () => {
  mount("/settings/general");
  const search = screen.getByRole("searchbox", { name: "Search settings" });
  fireEvent.change(search, { target: { value: "dark" } });
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["AppearanceDark · Dark mode"]);
  fireEvent.change(search, { target: { value: "zzzz" } });
  expect(screen.getByText(/No settings match/)).toBeTruthy();
  fireEvent.keyDown(search, { key: "Escape" });
  expect((search as HTMLInputElement).value).toBe("");
});

it("keeps the capabilities session and passes it to the panel", () => {
  mount("/settings/capabilities?session=abc");
  expect(screen.getByText("Capabilities for abc")).toBeTruthy();
});

it("goes back to where the user was before Settings, or Home", () => {
  render(
    <MemoryRouter initialEntries={["/session/one/insights"]}>
      <SettingsReturnProvider>
        <Routes>
          <Route path="/settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </SettingsReturnProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("link", { name: "About" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByTestId("where").textContent).toBe("/session/one/insights");
  cleanup();

  mount("/settings/about");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(where()).toBe("/");
});

it("leaves on Escape like Back, but never from a field or an open menu", () => {
  render(
    <MemoryRouter initialEntries={["/session/one/insights"]}>
      <SettingsReturnProvider>
        <Routes>
          <Route path="/settings/:section" element={<SettingsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </SettingsReturnProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  // A focused field keeps Escape (it may clear itself), and Settings stays.
  const search = screen.getByRole("searchbox", { name: "Search settings" });
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
  // An open menu keeps Escape too.
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  const item = document.createElement("button");
  menu.append(item);
  document.body.append(menu);
  fireEvent.keyDown(item, { key: "Escape" });
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
  menu.remove();
  // Composition in progress is not a dismissal.
  fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
  // Otherwise Escape returns to where Settings was opened from.
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByTestId("where").textContent).toBe("/session/one/insights");
  cleanup();

  // Arriving directly, Escape goes Home.
  mount("/settings/about");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(where()).toBe("/");
});

it("pushes from the phone's section list to a section and back", () => {
  state.mobile = true;
  mount("/settings");
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  fireEvent.click(within(nav).getByRole("link", { name: "SSH hosts" }));
  expect(screen.getByText("SSH manager")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
});
