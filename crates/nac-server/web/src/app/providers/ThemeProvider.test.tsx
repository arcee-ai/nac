import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/app/components/ThemeToggle";
import {
  ThemeProvider,
  useTheme,
} from "@/app/providers/ThemeProvider";

const QUERY = "(prefers-color-scheme: dark)";

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: QUERY,
    onchange: null,
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe(QUERY);
    return media;
  });
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    media,
    emit(next: boolean) {
      matches = next;
      const event = { matches: next, media: QUERY } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeState() {
  const { theme, resolved } = useTheme();
  return <output>{`${theme}:${resolved}`}</output>;
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeState />
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to system and follows media changes in system mode", () => {
    const system = installMatchMedia(false);
    renderTheme();

    expect(screen.getByText("system:light")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("light");
    expect(
      screen.getByRole("button", {
        name: "Theme: system (light). Switch to light",
      }),
    ).toHaveAttribute("data-theme-resolved", "light");

    act(() => system.emit(true));

    expect(screen.getByText("system:dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("keeps explicit modes stable and only listens while in system mode", async () => {
    const system = installMatchMedia(true);
    localStorage.setItem("nac-theme", "light");
    const user = userEvent.setup();
    renderTheme();

    expect(screen.getByText("light:light")).toBeInTheDocument();
    expect(system.media.addEventListener).not.toHaveBeenCalled();
    act(() => system.emit(false));
    expect(screen.getByText("light:light")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Theme: light. Switch to dark" }),
    );
    expect(screen.getByText("dark:dark")).toBeInTheDocument();
    expect(localStorage.getItem("nac-theme")).toBe("dark");
    expect(system.media.addEventListener).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Theme: dark. Switch to system" }),
    );
    expect(screen.getByText("system:light")).toBeInTheDocument();
    expect(system.media.addEventListener).toHaveBeenCalledOnce();
  });

  it("synchronizes valid cross-tab changes and resets removed values to system", () => {
    installMatchMedia(false);
    localStorage.setItem("nac-theme", "dark");
    renderTheme();

    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "nac-theme",
          newValue: "light",
        }),
      ),
    );
    expect(screen.getByText("light:light")).toBeInTheDocument();

    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: "nac-theme", newValue: null }),
      ),
    );
    expect(screen.getByText("system:light")).toBeInTheDocument();
  });
});
