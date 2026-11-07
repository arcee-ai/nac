/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigurationsModal } from "./ConfigurationsModal";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type {
  ModelConfigurationRecord,
  ProviderModel,
  ResolvedModelConfiguration,
} from "@/app/types/api";

const saved: ModelConfigurationRecord = {
  config_id: "saved-provider",
  name: "Saved provider",
  backend: "openai-responses",
  model: "gpt-5.6-sol",
  base_url: "https://gateway.example/v1",
  api_key_env: "STORED_KEY",
  allow_insecure_http: false,
  reasoning_effort: "high",
  extra_headers: { "X-Inherited": "exact" },
  initial_prompt: "Retained prompt",
  orchestrator_compaction_threshold: 321,
  light_model: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
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
  vi.spyOn(api, "getModelCatalog").mockResolvedValue({ catalog_version: 1, providers: [] });
  vi.spyOn(api, "listManagedAuth").mockResolvedValue({ providers: [] });
  vi.spyOn(api, "getManagedStatus").mockRejectedValue(new Error("unmanaged host"));
  vi.spyOn(api, "createModelConfig").mockResolvedValue(saved);
  vi.spyOn(api, "updateModelConfig").mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openForm(record = saved, models: ProviderModel[] = []) {
  vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [record] });
  const resolved: ResolvedModelConfiguration = {
    backend: "openai-responses",
    model: record.model,
    base_url: record.base_url,
    api_key_env: record.api_key_env ?? null,
    allow_insecure_http: false,
    reasoning_effort: "high",
    models,
    models_error: null,
  };
  vi.spyOn(api, "resolveModelConfig").mockResolvedValue(resolved);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfigurationsModal open onClose={vi.fn()} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Configuration name" }) as HTMLInputElement).value,
    ).toBe(record.name),
  );
  const name = screen.getByRole("textbox", { name: "Configuration name" });
  await waitFor(() => expect(api.resolveModelConfig).toHaveBeenCalled());
  return name;
}

async function expectFieldError(control: HTMLElement, message: string) {
  await waitFor(() => expect(control.getAttribute("aria-invalid")).toBe("true"));
  expect(document.activeElement).toBe(control);
  const describedBy = control.getAttribute("aria-describedby")!.split(" ");
  const alert = describedBy
    .map((id) => document.getElementById(id))
    .find((node) => node?.getAttribute("role") === "alert");
  expect(alert?.textContent).toContain(message);
  expect(alert?.closest("[data-configuration-field]")?.contains(control)).toBe(true);
  expect(api.updateModelConfig).not.toHaveBeenCalled();
  expect(api.createModelConfig).not.toHaveBeenCalled();
}

it("binds and focuses a missing name, clears it on edit and retries the unchanged saved tuple", async () => {
  const name = await openForm();
  fireEvent.change(name, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expectFieldError(name, "A name is required.");
  fireEvent.change(name, { target: { value: "Renamed provider" } });
  expect(name.getAttribute("aria-invalid")).toBeNull();
  expect(screen.queryByText("A name is required.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateModelConfig).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.updateModelConfig).mock.calls[0]).toEqual([
    saved.config_id,
    {
      name: "Renamed provider",
      backend: "openai-responses",
      model: saved.model,
      base_url: saved.base_url,
      allow_insecure_http: false,
      reasoning_effort: "high",
      extra_headers: saved.extra_headers,
      orchestrator_compaction_threshold: 321,
      initial_prompt: saved.initial_prompt,
      light_model: null,
    },
  ]);
  expect(vi.mocked(api.updateModelConfig).mock.calls[0]?.[1]).not.toHaveProperty("api_key");
  expect(api.createModelConfig).not.toHaveBeenCalled();
});

it("binds an empty native model input to its adjacent error", async () => {
  await openForm();
  const model = screen.getByRole("textbox", { name: "Default Model" });
  fireEvent.change(model, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expectFieldError(model, "A model is required.");
});

it("forwards error semantics to the actual model select trigger", async () => {
  await openForm({ ...saved, model: "" }, [{ id: "offered-model", display_name: "Offered model" }]);
  const group = screen.getByRole("group", { name: "Default Model*" });
  const model = await within(group).findByRole("button", {
    name: "No models offered",
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expectFieldError(model, "A model is required.");
});

it("binds malformed header feedback to the textarea without submitting", async () => {
  await openForm();
  const headers = screen.getByRole("textbox", { name: "Extra headers (JSON object)" });
  fireEvent.change(headers, { target: { value: "{invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expectFieldError(headers, "Extra Headers must be valid JSON");
});

it("binds an invalid compaction value without changing the model or saved threshold", async () => {
  await openForm();
  const threshold = screen.getByRole("textbox", { name: "Context Limit" });
  fireEvent.change(threshold, { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expectFieldError(threshold, "The compaction threshold must be a whole number");
  expect((screen.getByRole("textbox", { name: "Default Model" }) as HTMLInputElement).value).toBe(
    saved.model,
  );
});

it("binds missing dual selection to its picker, and returning to Single clears that field error", async () => {
  await openForm();
  fireEvent.click(screen.getByRole("button", { name: "Dual" }));
  const light = await screen.findByRole("button", { name: "Select a model" });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await expectFieldError(light, "Pick the light model before saving.");
  fireEvent.click(screen.getByRole("button", { name: "Single" }));
  await waitFor(() => expect(screen.queryByText("Pick the light model before saving.")).toBeNull());
});

it("announces and focuses a non-field save failure while retaining the draft for one retry", async () => {
  const update = vi.mocked(api.updateModelConfig);
  update.mockRejectedValueOnce(new Error("Controlled saved configuration failure"));
  const name = await openForm();
  fireEvent.change(name, { target: { value: "Retained retry draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Controlled saved configuration failure");
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect((name as HTMLInputElement).value).toBe("Retained retry draft");
  expect(name.getAttribute("aria-invalid")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(update.mock.calls[0]).toEqual(update.mock.calls[1]);
});

it("announces a late save failure without taking focus from a field the reader moved to", async () => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<ModelConfigurationRecord>((_resolve, fail) => {
    reject = fail;
  });
  vi.mocked(api.updateModelConfig).mockReturnValueOnce(pending);
  await openForm();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateModelConfig).toHaveBeenCalledTimes(1));
  const key = screen.getByLabelText("API Key", { exact: true });
  key.focus();
  reject(new Error("Controlled late save failure"));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Controlled late save failure");
  expect(document.activeElement).toBe(key);
  expect(
    (screen.getByRole("textbox", { name: "Configuration name" }) as HTMLInputElement).value,
  ).toBe(saved.name);
});
