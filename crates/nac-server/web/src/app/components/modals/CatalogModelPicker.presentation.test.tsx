/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Modal } from "@/app/atoms";
import { CatalogModelPicker } from "./CatalogModelPicker";
import type { ModelCatalog } from "@/app/types/api";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
const catalog: ModelCatalog = {
  catalog_version: 1,
  providers: [
    {
      id: "arcee-api",
      auth: "api_key_env",
      auth_status: "ready",
      auth_hint: null,
      connection: { base_url: "https://api.arcee.ai/api/v1", api_key_env: "ARCEE_API_KEY" },
      default_base_url: "https://api.arcee.ai/api/v1",
      managed_base_url: null,
      default_limits: { context_window: 128000, max_tokens: 4096, supported_efforts: [] },
      models: [
        "A very long model display name that must remain readable on a narrow screen",
        "Second model",
      ].map((display_name, n) => ({
        id: `model-${n}`,
        display_name,
        context_window: 128000,
        max_tokens: 4096,
        cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        reasoning: true,
        supported_efforts: [],
        source: "baseline",
      })),
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(props: Partial<Parameters<typeof CatalogModelPicker>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <MemoryRouter>
      <Modal open title="Model setup" onClose={onClose}>
        <CatalogModelPicker
          catalog={catalog}
          loading={false}
          failed={false}
          liveByBackend={new Map()}
          value={null}
          onSelect={onSelect}
          {...props}
        />
      </Modal>
    </MemoryRouter>,
  );
  return { ...view, onSelect, onClose };
}

it("keeps IME Enter in search and selects the actual keyboard model exactly once", async () => {
  const { onSelect } = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Select a model" }));
  const search = await screen.findByRole("textbox", { name: "Search models" });
  fireEvent.change(search, { target: { value: "Second" } });
  fireEvent.keyDown(search, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("group", { name: "Model results" })).toBeTruthy();
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    backend: "arcee-api",
    model: "model-1",
    baseUrl: "https://api.arcee.ai/api/v1",
  });
});

it("keeps empty search and unknown pricing understandable, then dismisses only the selector", async () => {
  const { onSelect, onClose } = fixture();
  const trigger = screen.getByRole("button", { name: "Select a model" });
  trigger.focus();
  fireEvent.click(trigger);
  const search = await screen.findByRole("textbox", { name: "Search models" });
  expect(screen.getAllByText(/pricing unknown/)).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: /A very long model display name/ }).textContent,
  ).toContain("model-0");
  fireEvent.change(search, { target: { value: "no match" } });
  expect(screen.getByRole("status").textContent).toContain('No model matches "no match"');
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Model setup" })).toBeTruthy();
});

it.each([
  { loading: true, failed: false, label: "Loading models…" },
  { loading: false, failed: true, label: "Model catalog unavailable" },
])("names the unavailable catalog: $label", ({ loading, failed, label }) => {
  fixture({ catalog: undefined, loading, failed });
  expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the compact composer trigger and actual keyboard selection contract", async () => {
  const { onSelect } = fixture({
    compact: true,
    value: { backend: "arcee-api", model: "model-0", baseUrl: "https://api.arcee.ai/api/v1" },
  });
  const trigger = screen.getByRole("button", { name: "Model" });
  expect(trigger.textContent).toContain("A very long model display name");
  fireEvent.click(trigger);
  const search = await screen.findByRole("textbox", { name: "Search models" });
  fireEvent.change(search, { target: { value: "Second" } });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    backend: "arcee-api",
    model: "model-1",
    baseUrl: "https://api.arcee.ai/api/v1",
  });
});
