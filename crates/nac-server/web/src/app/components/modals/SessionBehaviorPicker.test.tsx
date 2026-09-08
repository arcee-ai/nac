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
    expect(screen.getByText(/start a new chat to choose a different behavior/i)).toBeTruthy();

    const orchestrator = screen.getByRole("radio", { name: /^NAC orchestrator /i });
    expect(orchestrator.textContent).toMatch(/planner/i);
    expect(orchestrator.textContent).toMatch(/does not edit directly/i);
    expect(orchestrator.textContent).toMatch(/retained NAC worker threads/i);
    expect(orchestrator.textContent).toMatch(/Threads and Worksets/i);

    const direct = screen.getByRole("radio", { name: /^Direct coding agent /i });
    expect(direct.textContent).toMatch(/persistent coding agent/i);
    expect(direct.textContent).toMatch(/edits files and runs commands directly/i);
    expect(direct.textContent).toMatch(/fresh-context traditional coding agents/i);

    const hybrid = screen.getByRole("radio", { name: /^Direct \+ NAC orchestration /i });
    expect(hybrid.textContent).toMatch(/persistent coding agent/i);
    expect(hybrid.textContent).toMatch(/edits files and runs commands directly/i);
    expect(hybrid.textContent).toMatch(/separate NAC orchestrator sessions/i);
  });

  it("reports an explicit direct-with-orchestrator choice", () => {
    const onChange = vi.fn();
    render(<SessionBehaviorPicker value="orchestrator" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /^Direct \+ NAC orchestration /i }));

    expect(onChange).toHaveBeenCalledWith("direct-with-orchestrator");
  });

  it("supports roving keyboard selection with one tab stop", () => {
    const onChange = vi.fn();
    const view = render(<SessionBehaviorPicker value="orchestrator" onChange={onChange} />);
    const orchestrator = screen.getByRole("radio", { name: /^NAC orchestrator /i });
    const direct = screen.getByRole("radio", { name: /^Direct coding agent /i });

    expect(orchestrator.tabIndex).toBe(0);
    expect(direct.tabIndex).toBe(-1);
    orchestrator.focus();
    fireEvent.keyDown(orchestrator, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("direct");
    expect(document.activeElement).toBe(direct);

    view.rerender(<SessionBehaviorPicker value="direct" onChange={onChange} />);
    expect(direct.tabIndex).toBe(0);
  });
});
