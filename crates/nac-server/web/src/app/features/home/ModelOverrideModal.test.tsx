/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ModelOverrideModal } from "./ModelOverrideModal";
import type { LaunchModelSelection } from "@/app/components/modals/ConfigurationsPanel";
import type { InheritedModel } from "./modelChoice";

vi.mock("@/app/features/ui-policy/UiPolicyContext", () => ({
  useUiPolicy: () => ({ orchestrationEnabled: false }),
}));
vi.mock("@/app/features/setup/ModelSetupSection", () => ({
  ModelSetupSection: ({ onChange }: { onChange: (selection: LaunchModelSelection) => void }) => (
    <>
      <button
        onClick={() =>
          onChange({
            kind: "resolved",
            backend: "openai-responses",
            model: "other",
            base_url: "https://example.test",
            allow_insecure_http: false,
            api_key_env: null,
            reasoning_effort: "high",
            extra_headers: null,
            light_model: undefined,
          })
        }
      >
        Other provider
      </button>
      <button
        onClick={() =>
          onChange({
            kind: "resolved",
            backend: "chatgpt-codex-responses",
            model: "compatible",
            base_url: "https://chatgpt.com/backend-api",
            allow_insecure_http: false,
            api_key_env: null,
            reasoning_effort: "high",
            extra_headers: null,
            light_model: undefined,
          })
        }
      >
        Codex model
      </button>
    </>
  ),
}));
const inherited: InheritedModel = {
  initial: {
    backend: "chatgpt-codex-responses",
    model: "original",
    base_url: "https://chatgpt.com/backend-api",
    api_key_env: null,
    reasoning_effort: "high",
    service_tier: "fast",
    extra_headers: {},
  },
  light: null,
  source: "project-default",
};
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  const onApply = vi.fn();
  render(
    <MemoryRouter>
      <ModelOverrideModal
        open
        behavior="direct"
        inherited={inherited}
        inheritancePending={false}
        inheritanceError={null}
        current={null}
        onApply={onApply}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
  return onApply;
}
it("requires an explicit speed-only clear before selecting another provider", () => {
  const apply = mount();
  fireEvent.click(screen.getByText("Other provider"));
  fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use provider default for speed" }));
  fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: expect.objectContaining({ service_tier: null, backend: "openai-responses" }),
    }),
  );
});
it("allows another Codex model to inherit and reconcile the saved tier", () => {
  const apply = mount();
  fireEvent.click(screen.getByText("Codex model"));
  expect(screen.queryByRole("button", { name: "Use provider default for speed" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: expect.objectContaining({
        backend: "chatgpt-codex-responses",
        model: "compatible",
      }),
    }),
  );
});
