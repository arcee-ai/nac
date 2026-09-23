/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IconName } from "@/app/atoms";
import ToolPill, { ToolPillSize, ToolPillState } from "@/app/atoms/tool-pill";

afterEach(cleanup);

describe("ToolPill", () => {
  it("renders the requested size and visual state", () => {
    const { container, rerender } = render(
      <ToolPill icon={IconName.ReadFile} size={ToolPillSize.Small} />,
    );
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.dataset.state).toBe("default");
    expect(pill.style.width).toBe("28px");

    rerender(
      <ToolPill icon={IconName.ReadFile} size={ToolPillSize.Small} state={ToolPillState.Active} />,
    );
    expect((container.firstElementChild as HTMLElement).dataset.state).toBe("active");
    expect(container.querySelector(".animate-spin")).toBeTruthy();

    rerender(
      <ToolPill icon={IconName.ReadFile} size={ToolPillSize.Small} state={ToolPillState.Error} />,
    );
    expect((container.firstElementChild as HTMLElement).dataset.state).toBe("error");
    expect(container.querySelector(".text-error-primary")).toBeTruthy();
  });

  it("shows bounded overflow counts in the same size contract", () => {
    const { getByText, container } = render(
      <ToolPill.Overflow count={12} size={ToolPillSize.Small} />,
    );
    expect(getByText("+12")).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).dataset.overflowCount).toBe("12");
    expect((container.firstElementChild as HTMLElement).style.height).toBe("28px");
  });
});
