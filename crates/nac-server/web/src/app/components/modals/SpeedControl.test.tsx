/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SpeedControl } from "./SpeedControl";

const priority = { id: "priority", name: "Fast", description: "Priority" };
const ultra = { id: "ultrafast", name: "Ultrafast", description: "Ultra" };
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("toggles explicit Standard and Fast independently of provider default", () => {
  const onChange = vi.fn();
  const view = render(<SpeedControl tiers={[priority]} value={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Speed: Provider default" }));
  expect(onChange).toHaveBeenCalledWith("fast");
  view.rerender(<SpeedControl tiers={[priority]} value="fast" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Speed: Fast" }));
  expect(onChange).toHaveBeenLastCalledWith("standard");
});

it("hides the composer for revoked or unknown tiers but keeps a repair path in settings", () => {
  const onChange = vi.fn();
  const view = render(<SpeedControl tiers={[]} value="fast" onChange={onChange} />);
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<SpeedControl form tiers={[]} value="fast" onChange={onChange} />);
  expect(screen.getByText("Fast (unavailable)")).toBeTruthy();
});

it("offers three-way choices only when discovery includes Ultrafast", () => {
  render(<SpeedControl tiers={[priority, ultra]} value="standard" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /standard/i }));
  expect(screen.getByText("Ultrafast")).toBeTruthy();
  expect(screen.getByText("Use provider default")).toBeTruthy();
});

it("explains native API accelerated pricing, access and a documented context limit", () => {
  const view = render(
    <SpeedControl
      form
      openAiApi
      fastContextLimit={272000}
      tiers={[priority]}
      value="standard"
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText(/Higher token cost; subject to your OpenAI project/)).toBeTruthy();
  expect(screen.getByText(/fewer than 272,000 input tokens/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "OpenAI pricing" }).getAttribute("href")).toBe(
    "https://developers.openai.com/api/docs/pricing",
  );
  view.rerender(<SpeedControl tiers={[priority]} value="standard" onChange={vi.fn()} />);
  expect(screen.queryByRole("link", { name: "OpenAI pricing" })).toBeNull();
});

it("does not display an accelerated pricing note when acceleration is unavailable", () => {
  render(<SpeedControl openAiApi form tiers={[]} value={null} onChange={vi.fn()} />);
  expect(screen.queryByRole("link", { name: "OpenAI pricing" })).toBeNull();
});

it("toggles native Fast directly and offers mobile pricing separately", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const onChange = vi.fn();
  const view = render(
    <MemoryRouter>
      <SpeedControl
        openAiApi
        fastContextLimit={272000}
        tiers={[priority]}
        value="standard"
        onChange={onChange}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/Higher token cost/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Speed: Standard" }));
  expect(onChange).toHaveBeenCalledWith("fast");
  view.rerender(
    <MemoryRouter>
      <SpeedControl openAiApi tiers={[priority]} value="fast" onChange={onChange} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Speed: Fast" }));
  expect(onChange).toHaveBeenLastCalledWith("standard");
  view.rerender(
    <MemoryRouter>
      <SpeedControl
        openAiApi
        fastContextLimit={272000}
        tiers={[priority]}
        value="standard"
        onChange={onChange}
      />
    </MemoryRouter>,
  );
  const disclosure = screen.getByRole("button", { name: "Speed pricing and access" });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(disclosure);
  expect(screen.getByText(/Higher token cost/)).toBeTruthy();
  expect(screen.getByText(/fewer than 272,000 input tokens/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "OpenAI pricing" })).toBeTruthy();
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
});

it("marks the selected native Ultrafast menu choice visibly", () => {
  render(
    <MemoryRouter>
      <SpeedControl openAiApi tiers={[priority, ultra]} value="ultrafast" onChange={vi.fn()} />
    </MemoryRouter>,
  );
  const trigger = screen.getByRole("button", { name: "Speed: Ultrafast" });
  expect(trigger.querySelector("svg")).toBeNull();
  fireEvent.click(trigger);
  const selected = screen.getByRole("menuitemradio", { name: "Ultrafast" });
  expect(selected.getAttribute("aria-checked")).toBe("true");
  expect(selected.querySelector("svg")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Standard" }));
  fireEvent.click(screen.getByRole("button", { name: "Speed pricing and access" }));
  expect(screen.getByRole("link", { name: "OpenAI pricing" })).toBeTruthy();
});
