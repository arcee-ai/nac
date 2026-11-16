/** @vitest-environment jsdom */
import { Activity, useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopVisibility } from "./DesktopVisibility";
import { useDesktopVisible } from "./visibility";

afterEach(cleanup);
it("disconnects hidden presentation effects while retaining drafts and the outer interactive owner", async () => {
  let visibility!: (visible: boolean) => void;
  const released = vi.fn(),
    resumed = vi.fn(),
    interactiveClosed = vi.fn(),
    portClosed = vi.fn();
  function Editor() {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      resumed();
      return released;
    }, []);
    return (
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    );
  }
  function Session() {
    const visible = useDesktopVisible();
    useEffect(() => interactiveClosed, []);
    return (
      <Activity mode={visible ? "visible" : "hidden"}>
        <Editor />
      </Activity>
    );
  }
  const view = render(
    <DesktopVisibility
      port={{
        connectVisibility: (owner) => {
          visibility = owner;
          return portClosed;
        },
      }}
    >
      <Session />
    </DesktopVisibility>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "draft" }), {
    target: { value: "retained text" },
  });
  await act(async () => visibility(false));
  expect(released).toHaveBeenCalledOnce();
  expect(interactiveClosed).not.toHaveBeenCalled();
  await act(async () => visibility(true));
  expect(screen.getByRole("textbox", { name: "draft" })).toHaveProperty("value", "retained text");
  expect(resumed).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(portClosed).toHaveBeenCalledOnce();
  expect(interactiveClosed).toHaveBeenCalledOnce();
  await act(async () => visibility(false)); // retired native callbacks are inert
});
