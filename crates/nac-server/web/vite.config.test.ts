import { describe, expect, it } from "vitest";

import { API_PREFIXES, apiProxy } from "./vite.config";

describe("Vite development proxy", () => {
  it("routes every Rust API prefix to the configured backend", () => {
    const target = "http://127.0.0.1:43210";
    const proxy = apiProxy(target);

    expect(API_PREFIXES).toContain("/health");
    expect(API_PREFIXES).toContain("/ui-config");
    expect(API_PREFIXES).toContain("/sessions");
    expect(API_PREFIXES).toContain("/managed");
    expect(API_PREFIXES).toContain("/__managed");
    expect(Object.keys(proxy)).toEqual(API_PREFIXES);
    for (const prefix of API_PREFIXES) {
      expect(proxy[prefix]).toEqual({ target, changeOrigin: true });
    }
  });
});
