/** @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";

import CodeBlock from "@/app/atoms/code-block";

describe("CodeBlock highlighting", () => {
  it("paints javascript tokens with CSS-variable colours", async () => {
    const { container } = render(
      <CodeBlock code={"const n = 1;"} language="javascript" copyable={false} />,
    );

    await waitFor(() => {
      expect(container.querySelector("code span[style]")).not.toBeNull();
    });

    const html = container.querySelector("code")?.innerHTML ?? "";
    expect(html).toContain("var(--color-text-");
  });

  it("leaves unlabeled code as plain text", () => {
    const { container } = render(<CodeBlock code="plain" copyable={false} />);
    expect(container.querySelector("code span[style]")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain("plain");
  });
});

describe("react-markdown fence language class", () => {
  it("puts language-* on the fenced code element without a highlight plugin", () => {
    const { container } = render(<ReactMarkdown>{"```ts\nconst x = 1\n```"}</ReactMarkdown>);
    expect(container.querySelector("code")?.className).toMatch(/language-ts/);
  });
});
