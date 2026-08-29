/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionBehaviorPicker } from "@/app/components/modals/SessionBehaviorPicker";

afterEach(cleanup);

describe("session behavior picker", () => {
  it("shows Agent and NAC with Agent selected by default", () => {
    render(<SessionBehaviorPicker value="direct" onChange={() => {}} />);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /^Agent /i }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText(/start a new chat to choose a different behavior/i)).toBeTruthy();

    const agent = screen.getByRole("radio", { name: /^Agent /i });
    expect(agent.textContent).toMatch(/Default/);
    expect(agent.textContent).toMatch(/persistent coding agent/i);
    expect(agent.textContent).toMatch(/edits files and runs commands directly/i);
    expect(agent.textContent).toMatch(/fresh-context coding agents and separate NAC sessions/i);

    const nac = screen.getByRole("radio", { name: /^NAC /i });
    expect(nac.textContent).toMatch(/planner/i);
    expect(nac.textContent).toMatch(/does not edit directly/i);
    expect(nac.textContent).toMatch(/retained NAC worker threads/i);
    expect(nac.textContent).toMatch(/Threads and Worksets/i);
    expect(screen.queryByRole("radio", { name: /Direct \+ NAC/i })).toBeNull();
  });

  it("reports an explicit NAC choice", () => {
    const onChange = vi.fn();
    render(<SessionBehaviorPicker value="direct" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /^NAC /i }));

    expect(onChange).toHaveBeenCalledWith("orchestrator");
  });

  it("supports roving keyboard selection with one tab stop", () => {
    const onChange = vi.fn();
    const view = render(<SessionBehaviorPicker value="direct" onChange={onChange} />);
    const agent = screen.getByRole("radio", { name: /^Agent /i });
    const nac = screen.getByRole("radio", { name: /^NAC /i });

    expect(agent.tabIndex).toBe(0);
    expect(nac.tabIndex).toBe(-1);
    agent.focus();
    fireEvent.keyDown(agent, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("orchestrator");
    expect(document.activeElement).toBe(nac);

    view.rerender(<SessionBehaviorPicker value="orchestrator" onChange={onChange} />);
    expect(nac.tabIndex).toBe(0);
  });
});
