/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipPosition } from "@/app/atoms";
import { MessageActions } from "@/app/components/inspector/MessageActions";

const mocks = vi.hoisted(() => ({
  isMobile: false,
  writeText: vi.fn(),
}));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => mocks.isMobile,
}));

vi.mock("@/app/atoms/tooltip", async () => {
  const { AnchorPlacement } = await import("@/app/lib/anchor");
  return {
    TooltipPosition: AnchorPlacement,
    default: ({
      children,
      position,
      title,
    }: {
      children: ReactNode;
      position: string;
      title: ReactNode;
    }) => (
      <span data-position={position} data-title={String(title)}>
        {children}
      </span>
    ),
  };
});

function actions(overrides: Partial<Parameters<typeof MessageActions>[0]> = {}) {
  const props = {
    tooltipPosition: TooltipPosition.BottomLeft,
    messageIndex: 17,
    promptText: "exact prompt",
    copyText: "exact copy text",
    onRefresh: vi.fn(),
    onRevert: vi.fn(),
    ...overrides,
  };
  render(<MessageActions {...props} />);
  return props;
}

beforeEach(() => {
  mocks.isMobile = false;
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});

afterEach(cleanup);

describe("MessageActions", () => {
  it("passes the exact index and prompt to resend and revert", () => {
    const props = actions();

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Revert to this snapshot" }),
    );

    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(props.onRefresh).toHaveBeenCalledWith(17);
    expect(props.onRevert).toHaveBeenCalledOnce();
    expect(props.onRevert).toHaveBeenCalledWith(17, "exact prompt");
  });

  it("copies the exact model or user copy text", async () => {
    actions({ copyText: "first line\n\nsecond line" });
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith("first line\n\nsecond line"),
    );
  });

  it("hides resend and explains disabled revert when its index is absent", () => {
    actions({ messageIndex: undefined });

    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    const revert = screen.getByRole("button", {
      name: "Revert to this snapshot",
    });
    expect((revert as HTMLButtonElement).disabled).toBe(true);
    expect(revert.parentElement?.className).toContain("inline-flex");
    expect(revert.closest("[data-title]")?.getAttribute("data-title")).toBe(
      "This message is not in the transcript yet",
    );
  });

  it("also hides resend and disables revert when callbacks are absent", () => {
    actions({ onRefresh: null, onRevert: null });

    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    const revert = screen.getByRole("button", {
      name: "Revert to this snapshot",
    }) as HTMLButtonElement;
    expect(revert.disabled).toBe(true);
  });

  it("disabled actions cannot invoke otherwise available callbacks", () => {
    const props = actions({ disabled: true });
    const resend = screen.getByRole("button", { name: "Resend" });
    const revert = screen.getByRole("button", {
      name: "Revert to this snapshot",
    });

    expect((resend as HTMLButtonElement).disabled).toBe(true);
    expect((revert as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resend);
    fireEvent.click(revert);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(props.onRevert).not.toHaveBeenCalled();
  });

  it.each([
    [false, "btn-small", "btn-tertiary", TooltipPosition.BottomLeft],
    [true, "btn-medium", "btn-ghost", TooltipPosition.BottomRight],
  ])(
    "preserves desktop/mobile classes and tooltip position",
    (isMobile, size, variant, position) => {
      mocks.isMobile = isMobile;
      actions({ tooltipPosition: position });

      for (const button of screen.getAllByRole("button")) {
        expect(button.className).toContain(size);
        expect(button.className).toContain(variant);
        expect(button.className).toContain("md:!h-4 md:!min-h-4 md:!p-0");
        expect(button.closest("[data-position]")?.getAttribute("data-position")).toBe(
          position,
        );
      }
    },
  );
});
