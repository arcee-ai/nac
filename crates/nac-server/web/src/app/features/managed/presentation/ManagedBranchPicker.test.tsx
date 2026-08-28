/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedBranchPicker } from "@/app/features/managed/presentation/ManagedBranchPicker";

function mount(overrides: Partial<React.ComponentProps<typeof ManagedBranchPicker>> = {}) {
  const props: React.ComponentProps<typeof ManagedBranchPicker> = {
    branches: [
      "z-last",
      "main",
      "feature/long.prefix-with-dots-and-hyphens",
      "Release/2026.08-hotfix",
    ],
    value: "main",
    onValueChange: vi.fn(),
    isLoading: false,
    error: null,
    ...overrides,
  };
  const view = render(
    <MemoryRouter>
      <ManagedBranchPicker key="arcee-ai/managed-demo" {...props} />
    </MemoryRouter>,
  );
  return { ...view, props };
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("managed branch picker", () => {
  it("keeps the selected default while filtering case-insensitively and clearing", () => {
    const onValueChange = vi.fn();
    mount({ onValueChange });

    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    const input = screen.getByRole("combobox", { name: "Find branch" });
    expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(screen.getByRole("option", { name: "main" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.change(input, { target: { value: "RELEASE/2026" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Release/2026.08-hotfix",
    ]);
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("returns exact special branch names without normalization", () => {
    const onValueChange = vi.fn();
    mount({ onValueChange });

    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Find branch" }), {
      target: { value: "prefix-with" },
    });
    fireEvent.click(
      screen.getByRole("option", { name: "feature/long.prefix-with-dots-and-hyphens" }),
    );

    expect(onValueChange).toHaveBeenCalledWith("feature/long.prefix-with-dots-and-hyphens");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows loading, error, empty, and no-match states", () => {
    const view = mount({ branches: [], isLoading: true });
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    expect(screen.getByRole("status").textContent).toContain("Loading branches");

    view.rerender(
      <MemoryRouter>
        <ManagedBranchPicker
          key="arcee-ai/managed-demo"
          {...view.props}
          branches={[]}
          isLoading={false}
          error="GitHub refused the branch request"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert").textContent).toContain("GitHub refused the branch request");

    view.rerender(
      <MemoryRouter>
        <ManagedBranchPicker
          key="arcee-ai/managed-demo"
          {...view.props}
          branches={[]}
          isLoading={false}
          error={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status").textContent).toContain("No branches found");

    view.rerender(
      <MemoryRouter>
        <ManagedBranchPicker
          key="arcee-ai/managed-demo"
          {...view.props}
          branches={["main", "release"]}
          isLoading={false}
          error={null}
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Find branch" }), {
      target: { value: "missing" },
    });
    expect(screen.getByRole("status").textContent).toContain('No branches match "missing"');
  });

  it("navigates and selects without tabbing through the branch list", () => {
    const onValueChange = vi.fn();
    mount({ branches: ["main", "release", "topic/work"], onValueChange });

    const trigger = screen.getByRole("button", { name: "Branch: main" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const input = screen.getByRole("combobox", { name: "Find branch" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "release" }).id,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("release");

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Find branch" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes and clears its query when the repository changes", () => {
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Find branch" }), {
      target: { value: "release" },
    });

    view.rerender(
      <MemoryRouter>
        <ManagedBranchPicker
          key="arcee-ai/second"
          {...view.props}
          branches={["develop"]}
          value="develop"
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Branch: develop" }));
    expect(screen.getByRole<HTMLInputElement>("combobox", { name: "Find branch" }).value).toBe("");
    expect(screen.getByRole("option", { name: "develop" })).toBeTruthy();
  });
});
