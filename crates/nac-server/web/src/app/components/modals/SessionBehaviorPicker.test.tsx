/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionBehaviorPicker } from "@/app/components/modals/SessionBehaviorPicker";

afterEach(cleanup);

describe("session behavior picker", () => {
  it("shows all immutable behaviors with orchestrator selected by default", () => {
    render(<SessionBehaviorPicker value="orchestrator" onChange={() => {}} />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: /^NAC orchestrator /i }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText(/fixed for the lifetime/i)).toBeTruthy();
  });

  it("reports an explicit direct-with-orchestrator choice", () => {
    const onChange = vi.fn();
    render(<SessionBehaviorPicker value="orchestrator" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /^Direct \+ NAC orchestration /i }));

    expect(onChange).toHaveBeenCalledWith("direct-with-orchestrator");
  });
});
