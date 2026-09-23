/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Icon, IconName, TooltipPosition } from "@/app/atoms";
import { MessageActionIcon } from "@/app/components/inspector/MessageActionIcon";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

describe("MessageActionIcon", () => {
  it("keeps a native desktop button focusable and keyboard-compatible", () => {
    const onClick = vi.fn();
    render(
      <MessageActionIcon
        title="Revert to this snapshot"
        position={TooltipPosition.BottomLeft}
        isMobile={false}
        onClick={onClick}
      >
        <Icon iconName={IconName.TurnLeft} size={16} />
      </MessageActionIcon>,
    );

    const button = screen.getByRole("button", { name: "Revert to this snapshot" });
    expect(button.classList.contains("btn-small")).toBe(true);
    expect(button.classList.contains("btn-tertiary")).toBe(true);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("preserves mobile sizing and disabled tooltip access", () => {
    render(
      <MessageActionIcon
        title="Revert to this snapshot"
        ariaLabel="Revert to this snapshot"
        disabled
        disabledReason="This message is not in the transcript yet"
        position={TooltipPosition.BottomLeft}
        isMobile
      >
        <Icon iconName={IconName.TurnLeft} size={16} />
      </MessageActionIcon>,
    );

    const button = screen.getByRole("button", { name: "Revert to this snapshot" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.classList.contains("btn-medium")).toBe(true);
    expect(button.classList.contains("btn-ghost")).toBe(true);
    expect(button.parentElement?.classList.contains("inline-flex")).toBe(true);
    expect(screen.getByText("This message is not in the transcript yet")).not.toBeNull();
  });
});
