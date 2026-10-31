/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import ChatSessionMessage from "./index";

afterEach(cleanup);

it("renders a focusable href action with the existing small primary styling", () => {
  render(
    <ChatSessionMessage
      title="Account limit"
      action={{ label: "Open wallet", href: "https://platform.arcee.ai/api/wallet" }}
    />,
  );
  const link = screen.getByRole("link", { name: "Open wallet" });
  expect(link.tagName).toBe("A");
  expect(link.getAttribute("href")).toBe("https://platform.arcee.ai/api/wallet");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  for (const style of ["btn-small", "btn-primary", "btn-text"])
    expect(link.classList.contains(style)).toBe(true);
  link.focus();
  expect(document.activeElement).toBe(link);
  expect(screen.queryByRole("button", { name: "Open wallet" })).toBeNull();
});

it("retains command actions as buttons and invokes their callback once", () => {
  const retry = vi.fn();
  render(
    <ChatSessionMessage title="Retry available" action={{ label: "Try again", onClick: retry }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link")).toBeNull();
});
