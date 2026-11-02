import { describe, expect, it, vi } from "vitest";
import { ProductNavigation } from "./navigation";
import type {
  ProductContext,
  ProductNavigationRequest,
  ProductNavigationResolution,
} from "@/app/types/api";

const request: ProductNavigationRequest = {
  destination: "mcp-settings",
  session_id: "session",
  expected_build_id: "build",
};
function resolution(): ProductNavigationResolution {
  return {
    build: {
      product_version: "1.0.0",
      build_id: "build",
      track: "dev",
      source_revision: "revision",
    },
    session_id: "session",
    target: {
      destination: "mcp-settings",
      label: "MCP settings",
      availability: "available",
      steps: "Open MCP in the sidebar.",
    },
    opened: false,
  };
}
function context(): ProductContext {
  return {
    schema_version: 1,
    build: resolution().build,
    source: "installed-runtime",
    managed: false,
    features: [],
    session: {
      session_id: "session",
      behavior: "direct",
      execution_backend: "local",
      skills: { availability: "unknown", count: null },
      tools: { availability: "unknown", count: null },
    },
    mcp: { availability: "disabled", count: 0 },
    destinations: [resolution().target],
  };
}
function deferred() {
  let resolve!: (value: ProductNavigationResolution) => void;
  const promise = new Promise<ProductNavigationResolution>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("explicit scoped product navigation", () => {
  it("returns truthful headless steps and never replays on browser attachment", async () => {
    const resolve = vi.fn().mockResolvedValue(resolution());
    const nav = new ProductNavigation(
      resolve,
      () => false,
      async () => context(),
    );
    expect((await nav.open(request)).opened).toBe(false);
    const open = vi.fn().mockReturnValue(true);
    nav.connect({ currentSession: () => "session", open });
    expect(open).not.toHaveBeenCalled();
    expect((await nav.open(request)).opened).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it.each(["close", "replace", "route", "detach"] as const)(
    "discards a pending action after %s",
    async (change) => {
      const pending = deferred();
      let closed = false;
      let session = "session";
      const nav = new ProductNavigation(
        () => pending.promise,
        () => closed,
      );
      const open = vi.fn().mockReturnValue(true);
      const detach = nav.connect({ currentSession: () => session, open });
      const result = nav.open(request);
      if (change === "close") {
        closed = true;
        nav.close();
      }
      if (change === "replace") nav.connect({ currentSession: () => "session", open });
      if (change === "route") session = "another-session";
      if (change === "detach") detach();
      pending.resolve(resolution());
      await expect(result).rejects.toThrow("view changed");
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("rejects another session before resolution and validates server bindings", async () => {
    const resolve = vi.fn().mockResolvedValue(resolution());
    const nav = new ProductNavigation(
      resolve,
      () => false,
      async () => context(),
    );
    const open = vi.fn().mockReturnValue(true);
    nav.connect({ currentSession: () => "session", open });
    await expect(nav.open({ ...request, session_id: "other-owner" })).rejects.toThrow(
      "another session",
    );
    expect(resolve).not.toHaveBeenCalled();
    resolve.mockResolvedValue({ ...resolution(), session_id: "other-owner" });
    await expect(nav.open(request)).rejects.toThrow("binding changed");
    resolve.mockResolvedValue({
      ...resolution(),
      build: { ...resolution().build, build_id: "replacement" },
    });
    await expect(nav.open(request)).rejects.toThrow("binding changed");
    expect(open).not.toHaveBeenCalled();
  });

  it("never opens unavailable targets or an older superseded action", async () => {
    const first = deferred();
    const second = deferred();
    const resolve = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const nav = new ProductNavigation(
      resolve,
      () => false,
      async () => context(),
    );
    const open = vi.fn().mockReturnValue(true);
    nav.connect({ currentSession: () => "session", open });
    const older = nav.open(request);
    const newer = nav.open(request);
    second.resolve({
      ...resolution(),
      target: { ...resolution().target, availability: "unavailable" },
    });
    expect((await newer).opened).toBe(false);
    first.resolve(resolution());
    await expect(older).rejects.toThrow("view changed");
    expect(open).not.toHaveBeenCalled();
  });
});

it.each(["close", "replace", "route", "detach"] as const)(
  "fences %s while current context inspection is pending",
  async (change) => {
    let release!: (value: ProductContext) => void;
    const pending = new Promise<ProductContext>((done) => {
      release = done;
    });
    let arrived!: () => void;
    const accepted = new Promise<void>((done) => {
      arrived = done;
    });
    let session = "session";
    const nav = new ProductNavigation(
      async () => resolution(),
      () => false,
      () => {
        arrived();
        return pending;
      },
    );
    const open = vi.fn().mockReturnValue(true);
    const detach = nav.connect({ currentSession: () => session, open });
    const result = nav.open(request);
    await accepted;
    if (change === "close") nav.close();
    if (change === "replace") nav.connect({ currentSession: () => session, open });
    if (change === "route") session = "another-session";
    if (change === "detach") detach();
    release(context());
    await expect(result).rejects.toThrow("view changed");
    expect(open).not.toHaveBeenCalled();
  },
);

it.each(["build", "session", "availability"] as const)(
  "rejects changed current %s after successful resolution",
  async (change) => {
    const current = context();
    if (change === "build") current.build = { ...current.build, build_id: "replacement" };
    if (change === "session") current.session = null;
    if (change === "availability") current.destinations = [];
    const nav = new ProductNavigation(
      async () => resolution(),
      () => false,
      async () => current,
    );
    const open = vi.fn().mockReturnValue(true);
    nav.connect({ currentSession: () => "session", open });
    await expect(nav.open(request)).rejects.toThrow("binding changed");
    expect(open).not.toHaveBeenCalled();
  },
);
