/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { readStandaloneScope } from "./standaloneScope";
import { createPromptDraftStore } from "../store/promptDraftStore";

const binding = {
  owner: "serving-instance",
  profile: "standalone",
  organization: "serving-instance",
  host: "serving-instance",
  incarnation: "serving-instance",
  release: '["0.1.4","stable-build","stable","source-revision"]',
};
function bootstrap(data: unknown) {
  document.getElementById("nac-presentation-binding")?.remove();
  const script = document.createElement("script");
  script.id = "nac-presentation-binding";
  script.type = "application/json";
  script.textContent = JSON.stringify(data);
  document.head.append(script);
}
afterEach(() => {
  document.getElementById("nac-presentation-binding")?.remove();
  sessionStorage.clear();
});

describe("embedded standalone draft binding", () => {
  it("recovers same-server reloads but isolates replacement, build and browser origin", () => {
    const endpoint = "http://127.0.0.1:3210";
    bootstrap({ version: 1, scope: binding });
    const originalScope = readStandaloneScope(document, endpoint)!;
    const original = createPromptDraftStore(originalScope, sessionStorage);
    original.update("retained-session", "exact draft\n雪");
    original.release();
    expect(
      createPromptDraftStore(readStandaloneScope(document, endpoint)!, sessionStorage).get(
        "retained-session",
      ).text,
    ).toBe("exact draft\n雪");
    expect(
      createPromptDraftStore(
        readStandaloneScope(document, "https://other-host")!,
        sessionStorage,
      ).get("retained-session").text,
    ).toBe("");
    for (const replacement of [
      { ...binding, incarnation: "replacement-server" },
      { ...binding, release: '["0.1.5","new-build","stable","new-revision"]' },
    ]) {
      bootstrap({ version: 1, scope: replacement });
      const scope = readStandaloneScope(document, endpoint)!;
      expect(createPromptDraftStore(scope, sessionStorage).get("retained-session").text).toBe("");
    }
  });

  it("requires complete server bootstrap rather than constant fallback identities", () => {
    expect(readStandaloneScope(document, "http://localhost")).toBeNull();
    for (const field of Object.keys(binding)) {
      bootstrap({ version: 1, scope: { ...binding, [field]: "" } });
      expect(readStandaloneScope(document, "http://localhost")).toBeNull();
    }
    for (const data of [
      null,
      {},
      { version: 2, scope: binding },
      { version: 1, scope: { ...binding, profile: "hosted" } },
    ]) {
      bootstrap(data);
      expect(readStandaloneScope(document, "http://localhost")).toBeNull();
    }
    bootstrap({ version: 1, scope: binding });
    document.getElementById("nac-presentation-binding")!.textContent = "{corrupt";
    expect(readStandaloneScope(document, "http://localhost")).toBeNull();
  });
});
