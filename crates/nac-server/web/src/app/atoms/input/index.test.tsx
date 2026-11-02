/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Input from "./index";

afterEach(cleanup);

function description(field: HTMLElement): string {
  return (field.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
}

describe("Input", () => {
  it("is named by its label, described by its hint, and submits with its form", () => {
    const ref = createRef<HTMLInputElement>();
    const onCompositionStart = vi.fn();
    const onCompositionEnd = vi.fn();
    render(
      <form aria-label="Rename">
        <Input
          ref={ref}
          name="title"
          label="Title"
          hintText="Shown on the card"
          defaultValue="Draft"
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
      </form>,
    );

    const field = screen.getByLabelText<HTMLInputElement>("Title");
    expect(ref.current).toBe(field);
    expect(description(field)).toBe("Shown on the card");
    const form = screen.getByRole<HTMLFormElement>("form", { name: "Rename" });
    expect(new FormData(form).get("title")).toBe("Draft");

    fireEvent.compositionStart(field);
    fireEvent.compositionEnd(field, { data: "下書き" });
    expect(onCompositionStart).toHaveBeenCalledTimes(1);
    expect(onCompositionEnd).toHaveBeenCalledTimes(1);
  });

  it("reports an error in place of the hint, and reads busy but stays focusable while loading", () => {
    const view = render(
      <Input
        label="Title"
        hintText="Shown on the card"
        required
        validation
        validationText="Required"
      />,
    );
    const field = screen.getByLabelText<HTMLInputElement>("Title");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-required")).toBe("true");
    expect(description(field)).toBe("Required");

    view.rerender(<Input label="Title" hintText="Shown on the card" loading />);
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(field.getAttribute("aria-busy")).toBe("true");
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
    expect(description(field)).toBe("Shown on the card");

    view.rerender(<Input label="Title" isDisabled />);
    expect(field.disabled).toBe(true);
    expect(field.getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps the id and the extra description a caller passes", () => {
    render(
      <>
        <p id="title-extra">Up to 80 characters</p>
        <Input
          id="session-title"
          label="Title"
          hintText="Shown on the card"
          aria-describedby="title-extra"
        />
      </>,
    );
    const field = screen.getByLabelText("Title");
    expect(field.id).toBe("session-title");
    expect(description(field)).toBe("Shown on the card Up to 80 characters");
  });
});
