/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ItemFileButton } from "./ItemFileButton";
import type { ItemContext } from "./itemContent";

afterEach(cleanup);

const roots = ["/repo/crates/foo", "/container/work", "/remote/project/crates/foo"];

function renderFile(
  path: string,
  filePathPrefix: string | null | undefined,
  workspaceRoots = roots,
) {
  const openFile = vi.fn();
  const context = {
    sessionId: "session",
    resolveSession: vi.fn(),
    openSubagent: vi.fn(),
    openWorkset: vi.fn(),
    workspaceRoots,
    filePathPrefix,
    openFile,
  } as ItemContext;
  render(<ItemFileButton path={path} context={context} />);
  return { openFile, button: screen.getByRole<HTMLButtonElement>("button") };
}

it.each([
  "src/lib.rs",
  "./src/lib.rs",
  "/repo/crates/foo/src/lib.rs",
  "/container/work/src/lib.rs",
  "/remote/project/crates/foo/src/lib.rs",
  "file:///container/work/src/lib.rs",
])("opens the edited nested file for %s", (path) => {
  const { openFile, button } = renderFile(path, "crates/foo/");
  fireEvent.click(button);
  expect(openFile).toHaveBeenCalledExactlyOnceWith("crates/foo/src/lib.rs");
});

it.each(["src/lib.rs", "/repo/src/lib.rs"])("maps a repository-root session path %s", (path) => {
  const { openFile, button } = renderFile(path, "", ["/repo"]);
  fireEvent.click(button);
  expect(openFile).toHaveBeenCalledExactlyOnceWith("src/lib.rs");
});

it.each(["crates/foo", "crates/foo/"])("joins valid prefix %s once", (prefix) => {
  const { openFile, button } = renderFile("src/lib.rs", prefix);
  fireEvent.click(button);
  expect(openFile).toHaveBeenCalledExactlyOnceWith("crates/foo/src/lib.rs");
});

it.each([" app/", "app /", "#app/", "%61pp/"])("preserves filesystem prefix %s", (prefix) => {
  const cwd = `/repo/${prefix.slice(0, -1)}`;
  for (const path of ["src/lib.rs", `${cwd}/src/lib.rs`]) {
    const { openFile, button } = renderFile(path, prefix, [cwd]);
    fireEvent.click(button);
    expect(openFile).toHaveBeenCalledExactlyOnceWith(`${prefix}src/lib.rs`);
    cleanup();
  }
});

it("does not mistake a relative name resembling the prefix for a repository path", () => {
  const { openFile, button } = renderFile("crates/foo/src/lib.rs", "crates/foo/");
  fireEvent.click(button);
  expect(openFile).toHaveBeenCalledExactlyOnceWith("crates/foo/crates/foo/src/lib.rs");
});

it("retains a directory suffix without resolving the target to another directory", () => {
  const { openFile, button } = renderFile("src/", "crates/foo/");
  fireEvent.click(button);
  expect(openFile).toHaveBeenCalledExactlyOnceWith("crates/foo/src/");
});

it.each([null, undefined])("disables paths when the repository prefix is %s", (prefix) => {
  const { button, openFile } = renderFile("src/lib.rs", prefix);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(openFile).not.toHaveBeenCalled();
});

it.each([
  "../",
  "foo/../../",
  "/repo/",
  "https://host/repo/",
  "file:///repo/",
  ".",
  "./crates/foo/",
  "crates/foo//",
  "app\\child/",
  "C:/repo/",
  "app/./child/",
  "app/\u0000/",
])("rejects an unsafe repository prefix %s", (prefix) => {
  const { button, openFile } = renderFile("src/lib.rs", prefix);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(openFile).not.toHaveBeenCalled();
});

it.each([
  " src/lib.rs",
  "src/lib.rs ",
  "../src/lib.rs",
  "/repo/crates/foo/../other/lib.rs",
  "/repo/crates/foobar/src/lib.rs",
  "/outside/lib.rs",
  "https://host/src/lib.rs",
  "javascript:alert(1)",
  "file:///outside/lib.rs",
  "file:///container/work/%2e%2e/outside/lib.rs",
  "…/src/lib.rs",
  ".",
  "/container/work",
])("keeps an unmappable tool path disabled: %s", (path) => {
  const { button, openFile } = renderFile(path, "crates/foo/");
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(openFile).not.toHaveBeenCalled();
});
