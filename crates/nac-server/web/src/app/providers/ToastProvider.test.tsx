/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationBoundary } from "./PresentationBoundary";
import { ToastProvider, useToast } from "./ToastProvider";

type Api = ReturnType<typeof useToast>;

function Probe({ ready }: { ready: (api: Api) => void }) {
  ready(useToast());
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(fn, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("notification presentation preserves provider ownership", () => {
  it("announces status politely, errors urgently, and gives close a keyboard name", () => {
    let api!: Api;
    render(
      <ToastProvider>
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </ToastProvider>,
    );
    // The live region exists before its first content update. Adding an already
    // populated status node alone is not reliably announced by assistive tech.
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    act(() => {
      api.success("Saved", { keep: true });
      api.info("Queued", { keep: true });
      api.error("Could not save", { keep: true });
      api.danger("Connection lost", { keep: true });
    });
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toEqual([
      "Saved",
      "Queued",
    ]);
    expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual([
      "Could not save",
      "Connection lost",
    ]);
    const closes = screen.getAllByRole("button", { name: "Dismiss notification" });
    fireEvent.click(closes[0]);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("keeps IDs, per-toast life, keep and clear semantics across rerenders", () => {
    let api!: Api;
    render(
      <ToastProvider>
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </ToastProvider>,
    );
    let kept!: string;
    act(() => {
      api.info("Default life");
      api.success("Long life", { life: 5 });
      kept = api.info("Kept", { life: 1, keep: true });
    });
    act(() => vi.advanceTimersByTime(3000));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByText("Default life")).toBeNull();
    expect(screen.getByText("Long life")).toBeTruthy();
    expect(screen.getByText("Kept")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1850));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByText("Long life")).toBeNull();
    act(() => {
      api.removeToast(kept);
      api.removeToast(kept);
    });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByText("Kept")).toBeNull();
    act(() => api.info("Before clear", { keep: true }));
    act(() => api.clearToasts());
    act(() => api.info("After clear", { keep: true }));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByText("Before clear")).toBeNull();
    expect(screen.getByText("After clear")).toBeTruthy();
  });

  it("portals, IDs, dismissals, timers and clears remain independent in two presentations", () => {
    let first!: Api;
    let second!: Api;
    const view = render(
      <>
        <section data-testid="first">
          <PresentationBoundary>
            <ToastProvider>
              <Probe
                ready={(api) => {
                  first = api;
                }}
              />
            </ToastProvider>
          </PresentationBoundary>
        </section>
        <section data-testid="second">
          <PresentationBoundary>
            <ToastProvider>
              <Probe
                ready={(api) => {
                  second = api;
                }}
              />
            </ToastProvider>
          </PresentationBoundary>
        </section>
      </>,
    );
    let firstId!: string;
    let secondId!: string;
    act(() => {
      firstId = first.info("First", { keep: true });
      secondId = second.error("Second", { life: 5 });
    });
    expect(firstId).not.toBe(secondId);
    expect(within(screen.getByTestId("first")).getByRole("status").textContent).toBe("First");
    expect(within(screen.getByTestId("second")).getByRole("alert").textContent).toBe("Second");
    act(() => {
      first.removeToast(secondId);
      first.clearToasts();
    });
    act(() => vi.advanceTimersByTime(3150));
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
