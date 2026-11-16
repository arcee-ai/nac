/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { NativePresentationRoot } from "./NativePresentationRoot";
import { createNativeRuntime } from "./nativeRuntime";
import { createNacClient } from "../services/nacClient";
import { useTerminalLinkMode } from "../features/terminal/terminalLinkMode";

vi.mock("../../App", () => ({
  default: function AppProbe() {
    return <output>{useTerminalLinkMode()}</output>;
  },
}));
vi.mock("../providers/PresentationBoundary", () => ({
  PresentationBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../providers/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ resolved: "dark" }),
}));
const instances: ReturnType<typeof createNativeRuntime>[] = [];
function fixture() {
  const runtime = createNativeRuntime({
    scope: {
      owner: "test",
      profile: "test",
      organization: "test",
      host: "test",
      incarnation: "test",
      endpoint: "/test",
      release: "test",
    },
    client: createNacClient({ endpoint: "/test", fetch: vi.fn() }),
  });
  instances.push(runtime);
  const release = vi.fn();
  const retain = runtime.retain;
  vi.spyOn(runtime, "retain").mockImplementation(() => {
    const dispose = retain();
    return () => {
      release();
      dispose();
    };
  });
  return { runtime, release };
}
afterEach(() => {
  cleanup();
  for (const runtime of instances.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});

it("defaults to browser presentation despite ambient native-like globals", () => {
  vi.stubGlobal("__nacDesktop", { connect: vi.fn() });
  const { runtime, release } = fixture();
  const view = render(<NativePresentationRoot runtime={runtime} router={(child) => child} />);
  expect(screen.getByRole("status").textContent).toBe("browser");
  view.unmount();
  expect(release).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it("selects only an explicitly supplied desktop capability and retires with its presentation", () => {
  const { runtime, release } = fixture();
  const connect = vi.fn(() => () => {});
  const router = (child: ReactNode) => child;
  const view = render(
    <NativePresentationRoot runtime={runtime} router={router} desktopCommands={{ connect }} />,
  );
  expect(screen.getByRole("status").textContent).toBe("native-visible-anchor");
  // Selecting presentation is not connecting menus or granting an operation.
  expect(connect).not.toHaveBeenCalled();
  view.rerender(<NativePresentationRoot runtime={runtime} router={router} />);
  expect(screen.getByRole("status").textContent).toBe("browser");
  act(() => {
    runtime.close();
  });
  expect(screen.queryByRole("status")).toBeNull();
  view.unmount();
  expect(release).toHaveBeenCalledOnce();
});
