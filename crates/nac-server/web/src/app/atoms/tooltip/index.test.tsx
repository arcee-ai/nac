/** @vitest-environment jsdom */

import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Button from "../button";
import Tooltip from "./index";

const device = vi.hoisted(() => ({ mobile: false }));
vi.mock("../../hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useMediaQuery")>()),
  useIsMobile: () => device.mobile,
}));

beforeEach(() => {
  device.mobile = false;
});
afterEach(cleanup);

describe("Tooltip descriptions", () => {
  it("describes nested focus without replacing the control's ref or events", () => {
    const ref = createRef<HTMLButtonElement>();
    const onFocus = vi.fn();
    const onClick = vi.fn();
    render(
      <Tooltip title="Rename chat" description="Change its display title" sticky>
        <span>
          <Button ref={ref} onFocus={onFocus} onClick={onClick}>
            Rename Draft plan
          </Button>
        </span>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Rename Draft plan" });
    act(() => button.focus());
    expect(
      screen.getByRole("button", {
        name: "Rename Draft plan",
        description: "Rename chat Change its display title",
      }),
    ).toBe(button);
    expect(ref.current).toBe(button);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("merges descriptions on compound children and preserves caller updates on close", async () => {
    function Fields({ description }: { description: string }) {
      return (
        <>
          <p id="existing">Existing hint</p>
          <p id="updated">Updated hint</p>
          <Tooltip title="Saved automatically" sticky>
            <div>
              <Button aria-describedby={description}>Status</Button>
              <a href="#details">Details</a>
            </div>
          </Tooltip>
        </>
      );
    }
    const view = render(<Fields description="existing" />);
    const button = screen.getByRole("button", { name: "Status" });
    const link = screen.getByRole("link", { name: "Details" });
    fireEvent.mouseEnter(button);
    expect(
      screen.getByRole("button", {
        name: "Status",
        description: "Existing hint Saved automatically",
      }),
    ).toBe(button);
    expect(screen.getByRole("link", { name: "Details", description: "Saved automatically" })).toBe(
      link,
    );
    view.rerender(<Fields description="updated" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Status",
          description: "Updated hint Saved automatically",
        }),
      ).toBe(button),
    );
    fireEvent.mouseLeave(button);
    expect(button.getAttribute("aria-describedby")).toBe("updated");
    expect(link.hasAttribute("aria-describedby")).toBe(false);
    fireEvent.mouseEnter(button);
    view.unmount();
    expect(button.getAttribute("aria-describedby")).toBe("updated");
    expect(link.hasAttribute("aria-describedby")).toBe(false);
  });

  it("describes descendants mounted while open and removes its association when disabled", async () => {
    function Content({ extra, disabled = false }: { extra: boolean; disabled?: boolean }) {
      return (
        <Tooltip title="Details" disabled={disabled}>
          <Button>First</Button>
          {extra ? <Button>Second</Button> : null}
        </Tooltip>
      );
    }
    const view = render(<Content extra={false} />);
    const first = screen.getByRole("button", { name: "First" });
    fireEvent.mouseEnter(first);
    view.rerender(<Content extra />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Second", description: "Details" })).toBeTruthy(),
    );
    view.rerender(<Content extra disabled />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(first.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.getByRole("button", { name: "Second" }).hasAttribute("aria-describedby")).toBe(
      false,
    );
  });

  it("keeps noninteractive hints nonfocusable and suppresses desktop hints on mobile", () => {
    const view = render(
      <Tooltip title="More information">
        <span>Info glyph</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Info glyph"));
    expect(screen.getByRole("tooltip").textContent).toBe("More information");
    expect(view.container.querySelector("[tabindex]")).toBeNull();
    device.mobile = true;
    view.rerender(
      <Tooltip title="More information">
        <span>Info glyph</span>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
