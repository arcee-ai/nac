/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/app/services/api";
import { ManagedStatusPanel } from "./ManagedStatusPanel";

const fakes = vi.hoisted(() => ({ status: {} as Record<string, unknown> }));
const host = {
  logical_host_id: "fixture-host",
  public_hostname: "host.example.test",
  model_ready: false,
  model: {
    display_name: "Managed Arcee",
    id: "model-id",
    endpoint: "https://model.example.test/v1",
  },
  github_status: "not-configured",
  project_count: 2,
  secret_count: 1,
  repository_root: "/repositories",
  version: "0.1.4",
  schema_version: 25,
  checks: [
    { name: "store", ready: true, detail: "Store is open" },
    { name: "model", ready: false, detail: "Credential is not configured" },
  ],
};
const deniedReads = [
  [
    "private response",
    new ApiError(403, "GET", "/managed/status", "private denial detail", "denied-read"),
  ],
  [
    "provider-like response",
    new ApiError(
      403,
      "GET",
      "/managed/status",
      "invalid model configuration: private denial detail",
      "denied-config",
    ),
  ],
  ["status payload", { status: 403 }],
] as const;
vi.mock("@/app/features/managed/queries", () => ({ useManagedHostStatus: () => fakes.status }));
vi.mock("./ManagedUpgradePanel", () => ({ ManagedUpgradePanel: () => <div>Upgrade status</div> }));
afterEach(cleanup);
beforeEach(() => {
  fakes.status = { isLoading: false, data: null, error: null };
});

it.each(deniedReads)("keeps an initial host denial in context: %s", (_label, error) => {
  fakes.status = { isLoading: false, data: null, error };
  render(<ManagedStatusPanel />);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Managed host status is unavailable");
  expect(alert.textContent).toContain(
    "Access to this managed host was denied. Ask the host owner to check access.",
  );
  expect(alert.textContent).not.toMatch(/model|private denial detail|workspace/i);
  expect(screen.queryByText("Upgrade status")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(deniedReads)("keeps cached host details during a denial: %s", (_label, error) => {
  fakes.status = { isLoading: false, data: host, error: null };
  const view = render(<ManagedStatusPanel />);
  fakes.status = { ...fakes.status, error };
  view.rerender(<ManagedStatusPanel />);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Last known status is shown below");
  expect(alert.textContent).toContain(
    "Access to this managed host was denied. Ask the host owner to check access.",
  );
  expect(alert.textContent).not.toMatch(/model|private denial detail|workspace/i);
  expect(screen.getByText("fixture-host")).toBeTruthy();
  expect(screen.getByText("/repositories")).toBeTruthy();
  expect(screen.getByText("Upgrade status")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("names checking and unavailable states rather than showing an empty surface", () => {
  fakes.status = { isLoading: true, isPending: true };
  const view = render(<ManagedStatusPanel />);
  expect(screen.getByRole("status").textContent).toContain("Checking managed host");
  fakes.status = { isLoading: false, data: null, error: { status: 403 } };
  view.rerender(<ManagedStatusPanel />);
  expect(screen.getByRole("alert").textContent).toContain("Managed host status is unavailable");
  expect(screen.queryByText("Upgrade status")).toBeNull();
});

it("exposes readiness by words with detail and preserves exact host values", () => {
  fakes.status = {
    isLoading: false,
    data: host,
  };
  const view = render(<ManagedStatusPanel />);
  const readiness = screen.getByRole("region", { name: "Readiness" });
  const items = within(readiness).getAllByRole("listitem");
  expect(items[0]?.textContent).toContain("Ready");
  expect(items[1]?.textContent).toContain("Needs attention");
  expect(items[1]?.textContent).toContain("Credential is not configured");
  expect(screen.getByText("not configured")).toBeTruthy();
  expect(screen.getByText("https://model.example.test/v1")).toBeTruthy();
  expect(screen.getByText("/repositories")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  fakes.status = { ...fakes.status, error: new Error("Host is offline") };
  view.rerender(<ManagedStatusPanel />);
  expect(screen.getByRole("alert").textContent).toContain("Last known status is shown below");
  expect(screen.getByText("/repositories")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
