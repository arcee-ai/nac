/** @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Modal from "../modal";
import Tooltip from "../tooltip";
import Popover from "./index";

let mobile = false;
vi.mock("../../hooks/useMediaQuery", () => ({ useIsMobile: () => mobile }));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture(scoped = true, closeOnEscape = true, hint = false) {
  const panelClose = vi.fn();
  const action = vi.fn();
  let removeReconnect = () => {};
  function Example() {
    const [open, setOpen] = useState(false);
    const [review, setReview] = useState(false);
    const [available, setAvailable] = useState(true);
    removeReconnect = () => setAvailable(false);
    return (
      <MemoryRouter>
        <Modal open title="Terminal panel" onClose={panelClose}>
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            sticky
            focusScope={scoped ? "Terminal actions" : undefined}
            closeOnEscape={closeOnEscape}
            content={
              <>
                {available ? (
                  <button
                    onClick={() => {
                      setOpen(false);
                      action();
                    }}
                  >
                    Reconnect
                  </button>
                ) : null}
                <button disabled>Unavailable control</button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setReview(true);
                  }}
                >
                  Review selection
                </button>
              </>
            }
          >
            <button onClick={() => setOpen(!open)}>Terminal options</button>
          </Popover>
          <button>Other panel action</button>
          {hint ? (
            <Tooltip title="Shell details">
              <span>Terminal details</span>
            </Tooltip>
          ) : null}
        </Modal>
        <Modal open={review} title="Review terminal selection" onClose={() => setReview(false)}>
          <button>Send selection</button>
        </Modal>
      </MemoryRouter>
    );
  }
  const view = render(<Example />);
  const trigger = screen.getByRole("button", { name: "Terminal options" });
  trigger.focus();
  fireEvent.click(trigger);
  return { ...view, trigger, panelClose, action, removeReconnect: () => removeReconnect() };
}

describe.each([false, true])("portaled options at mobile=%s", (phone) => {
  beforeEach(() => {
    mobile = phone;
  });

  it("focuses actions and cycles Tab in both directions, skipping disabled rows", () => {
    fixture();
    const menu = screen.getByRole("dialog", { name: "Terminal actions" });
    expect(screen.getByRole("dialog", { name: "Terminal panel" }).contains(menu)).toBe(false);
    const first = within(menu).getByRole("button", { name: "Reconnect" });
    const last = within(menu).getByRole("button", { name: "Review selection" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab" });
    expect(document.activeElement).toBe(last);
  });

  it("consumes Escape and returns focus without dismissing the enclosing panel", async () => {
    const f = fixture();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Terminal actions" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(f.trigger));
    expect(f.panelClose).not.toHaveBeenCalled();
    if (phone) expect(screen.getByText("Reconnect").closest("[inert]")).not.toBeNull();
  });

  it("retains focus when a control disappears and respects disabled Escape dismissal", () => {
    const f = fixture(true, false);
    act(f.removeReconnect);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Review selection" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Terminal actions" })).toBeTruthy();
    expect(f.panelClose).not.toHaveBeenCalled();
  });

  it("restores focus on an action and lets a newly opened review dialog own focus", async () => {
    const f = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(f.action).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(f.trigger));
    fireEvent.click(f.trigger);
    fireEvent.click(screen.getByRole("button", { name: "Review selection" }));
    expect(document.activeElement).toBe(
      screen.getByRole("dialog", { name: "Review terminal selection" }),
    );
    expect(f.panelClose).not.toHaveBeenCalled();
  });
});

it("leaves existing unscoped popover focus behavior unchanged", () => {
  mobile = false;
  const f = fixture(false);
  expect(document.activeElement).toBe(f.trigger);
});

describe.each([true, false])("topmost dismissal with closeOnEscape=%s", (closeOnEscape) => {
  it("takes the hint before the focused terminal menu", async () => {
    mobile = false;
    const f = fixture(true, closeOnEscape, true);
    const action = screen.getByRole("button", { name: "Reconnect" });
    expect(document.activeElement).toBe(action);
    fireEvent.mouseEnter(screen.getByText("Terminal details"));
    expect(screen.getByRole("tooltip").textContent).toBe("Shell details");
    fireEvent.keyDown(action, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Terminal actions" })).toBeTruthy();
    expect(document.activeElement).toBe(action);
    expect(f.panelClose).not.toHaveBeenCalled();
    fireEvent.keyDown(action, { key: "Escape" });
    if (closeOnEscape) {
      expect(screen.queryByRole("dialog", { name: "Terminal actions" })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(f.trigger));
    } else {
      expect(screen.getByRole("dialog", { name: "Terminal actions" })).toBeTruthy();
    }
    expect(f.panelClose).not.toHaveBeenCalled();
  });
});
