/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CreateProjectModal } from "@/app/components/modals/CreateProjectModal";
import { routes } from "@/app/lib/routes";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api, ApiError } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import type { ProjectRecord, StoreInfo } from "@/app/types/api";

vi.mock("@/app/components/modals/PathPickerModal", () => ({
  PathPickerModal: ({
    open,
    initialPath,
    onSelect,
  }: {
    open: boolean;
    initialPath: string;
    onSelect: (path: string) => void;
  }) =>
    open ? (
      <>
        <output data-testid="picker-initial-path">{initialPath}</output>
        <button onClick={() => onSelect("/workspace/new")}>Choose different folder</button>
        <button onClick={() => onSelect("/workspace/Project 日本語 ")}>
          Choose literal folder
        </button>
      </>
    ) : null,
}));

vi.mock("@/app/components/modals/SshConnectionBox", () => ({
  SshConnectionBox: ({
    onConnectionChange,
  }: {
    onConnectionChange: (
      target: { ssh_host: string; ssh_port: null; ssh_identity_file: null },
      home: string,
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onConnectionChange(
          { ssh_host: "literal-build-alias", ssh_port: null, ssh_identity_file: null },
          "/home/fixture/workspace",
        )
      }
    >
      Connect fixture SSH
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(api, "getStore").mockResolvedValue({ root_cwd: "/workspace" } as StoreInfo);
  vi.spyOn(api, "createProject").mockResolvedValue({
    project_id: "created-project",
  } as ProjectRecord);
  vi.spyOn(api, "createSession");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.storeInfo, { root_cwd: "/workspace" } as StoreInfo);
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <CreateProjectModal open onClose={onClose} />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

const create = () => screen.getByRole("button", { name: "Create Project" });

it("creates only the project, asking nothing about sessions, then opens the composer on it", async () => {
  const onClose = vi.fn();
  const { client, view } = renderModal(onClose);
  try {
    for (const sessionField of [/Primary model/, /Reasoning/, /Context Limit/, /Sandbox/]) {
      expect(screen.queryByText(sessionField)).toBeNull();
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "Fixture project" },
    });
    fireEvent.click(create());
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(routes.newSession("created-project")),
    );
    expect(api.createProject).toHaveBeenCalledOnce();
    expect(vi.mocked(api.createProject).mock.calls[0]?.[0]).toEqual({
      name: "Fixture project",
      cwd: "/workspace",
      ssh_host: null,
      ssh_port: null,
      ssh_identity_file: null,
    });
    expect(api.createSession).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText("Project created")).toBeTruthy();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("creates an SSH project at the connected host's folder once", async () => {
  const { client, view } = renderModal();
  try {
    fireEvent.click(screen.getByRole("button", { name: "SSH" }));
    expect((create() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Connect fixture SSH" }));
    fireEvent.click(create());
    fireEvent.click(create());
    await waitFor(() => expect(api.createProject).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createProject).mock.calls[0]?.[0]).toMatchObject({
      cwd: "/home/fixture/workspace",
      ssh_host: "literal-build-alias",
      ssh_port: null,
      ssh_identity_file: null,
    });
  } finally {
    view.unmount();
    client.clear();
  }
});

it("reopens and submits the exact selected local folder with trailing whitespace", async () => {
  const { client, view } = renderModal();
  try {
    fireEvent.click(screen.getByText("/workspace"));
    fireEvent.click(screen.getByRole("button", { name: "Choose literal folder" }));
    fireEvent.click(screen.getByText("/workspace/Project 日本語", { exact: false }));
    expect(screen.getByTestId("picker-initial-path").textContent).toBe(
      "/workspace/Project 日本語 ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose literal folder" }));
    fireEvent.click(create());
    await waitFor(() => expect(api.createProject).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createProject).mock.calls[0]?.[0]).toMatchObject({
      cwd: "/workspace/Project 日本語 ",
      name: null,
    });
  } finally {
    view.unmount();
    client.clear();
  }
});

it("shows a rejected folder and allows a new one", async () => {
  vi.mocked(api.createProject).mockRejectedValueOnce(
    new ApiError(409, "POST", "/projects", "A project already uses this folder", "duplicate"),
  );
  const { client, view } = renderModal();
  try {
    fireEvent.click(create());
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /A project already uses this folder/,
    );
    expect((create() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("/workspace"));
    fireEvent.click(screen.getByRole("button", { name: "Choose different folder" }));
    expect((create() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(create());
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createProject).mock.calls[1]?.[0]).toMatchObject({
      cwd: "/workspace/new",
    });
  } finally {
    view.unmount();
    client.clear();
  }
});

it("creates nothing when closed without submitting", async () => {
  const onClose = vi.fn();
  const { client, view } = renderModal(onClose);
  try {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createProject).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});
