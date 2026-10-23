/** @vitest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SubagentChatInputBox } from "./SubagentChatInputBox";

afterEach(cleanup);

function mount(mobile = false) {
  window.matchMedia = (query: string) =>
    ({
      matches: mobile && query.startsWith("(max-width:"),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      addEventListener() {},
      removeEventListener() {},
    }) as MediaQueryList;
  const submit = vi.fn();
  const stop = vi.fn();
  function Composer() {
    const [value, setValue] = useState("Check permissions");
    return (
      <SubagentChatInputBox
        value={value}
        onChange={setValue}
        onSubmit={() => {
          submit(value);
          setValue("");
        }}
        onStop={stop}
        running
        background
        onBackgroundChange={() => {}}
      />
    );
  }
  render(<Composer />);
  return { submit, stop, field: screen.getByRole("textbox") };
}

it.each(["keyboard", "touch", "mouse"])(
  "repeated %s activation of Steer cannot become cancellation",
  (input) => {
    const { submit, stop } = mount();
    const send = screen.getByRole("button", { name: "Steer" });
    const click = () => {
      if (input === "touch") {
        fireEvent.touchStart(send);
        fireEvent.touchEnd(send);
      }
      fireEvent.click(send, { detail: input === "keyboard" ? 0 : 1 });
    };
    send.focus();
    click();
    click();
    fireEvent.submit(send.closest("form")!);
    expect(screen.getByRole("button", { name: "Steer" })).toBe(send);
    expect(submit).toHaveBeenCalledExactlyOnceWith("Check permissions");
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledOnce();
  },
);

it("ignores IME Enter and permits Shift+Enter before desktop Enter sends", () => {
  const { field, submit, stop } = mount();
  fireEvent.keyDown(field, { key: "Enter", isComposing: true });
  fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.keyDown(field, { key: "Enter", repeat: true });
  expect(submit).toHaveBeenCalledOnce();
  expect(stop).not.toHaveBeenCalled();
});

it("preserves mobile Enter for newlines while explicit Cmd/Ctrl+Enter sends", () => {
  const { field, submit, stop } = mount(true);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  expect(submit).toHaveBeenCalledOnce();
  fireEvent.keyDown(field, { key: "Enter", metaKey: true });
  expect(stop).not.toHaveBeenCalled();
});
