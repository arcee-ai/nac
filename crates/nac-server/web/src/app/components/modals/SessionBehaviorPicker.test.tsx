/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionBehaviorPicker } from "@/app/components/modals/SessionBehaviorPicker";

afterEach(cleanup);

describe("session behavior picker", () => {
  it("shows Agent, Agent + Orchestrator, and Orchestrator with Agent selected by default", () => {
    render(<SessionBehaviorPicker value="direct" onChange={() => {}} />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /Agent Default/i }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText(/start a new chat to choose a different behavior/i)).toBeTruthy();

    const agent = screen.getByRole("radio", { name: /Agent Default/i });
    expect(agent.textContent).toMatch(/Default/);
    expect(agent.textContent).toMatch(/persistent coding agent/i);
    expect(agent.textContent).toMatch(/edits files and runs commands directly/i);
    expect(agent.textContent).toMatch(/fresh-context coding agents/i);

    const hybrid = screen.getByRole("radio", { name: /Agent \+ Orchestrator/i });
    expect(hybrid.textContent).toMatch(/separate Orchestrator sessions/i);

    const orchestrator = screen.getByRole("radio", { name: /^Orchestrator /i });
    expect(orchestrator.textContent).toMatch(/planner/i);
    expect(orchestrator.textContent).toMatch(/does not edit directly/i);
    expect(orchestrator.textContent).toMatch(/retained Orchestrator worker threads/i);
    expect(orchestrator.textContent).toMatch(/Actions and Worksets/i);
  });

  it("reports an explicit Orchestrator choice", () => {
    const onChange = vi.fn();
    render(<SessionBehaviorPicker value="direct" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /^Orchestrator /i }));

    expect(onChange).toHaveBeenCalledWith("orchestrator");
  });

  it("supports roving keyboard selection with one tab stop", () => {
    const onChange = vi.fn();
    const view = render(<SessionBehaviorPicker value="direct" onChange={onChange} />);
    const agent = screen.getByRole("radio", { name: /Agent Default/i });
    const hybrid = screen.getByRole("radio", { name: /Agent \+ Orchestrator/i });
    const orchestrator = screen.getByRole("radio", { name: /^Orchestrator /i });

    expect(agent.tabIndex).toBe(0);
    expect(hybrid.tabIndex).toBe(-1);
    expect(orchestrator.tabIndex).toBe(-1);
    agent.focus();
    fireEvent.keyDown(agent, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("direct-with-orchestrator");
    expect(document.activeElement).toBe(hybrid);

    view.rerender(
      <SessionBehaviorPicker value="direct-with-orchestrator" onChange={onChange} />,
    );
    expect(hybrid.tabIndex).toBe(0);
  });
});
