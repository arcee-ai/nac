import { afterEach, expect, test, vi } from "vitest";
const id = "00000000-0000-0000-0000-000000000001";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("diagnostic accepts only existing identifiers and canonical cursors", async () => {
  const { phaseKey } = await import("./terminalPhaseProfile");
  expect(
    phaseKey(
      `/sessions/s/executions/e/observers/${id}/read`,
      { acknowledge_offset: "12", payload: "secret" },
      id,
    ),
  ).toEqual({ observer: id, cursor: "12", request: id });
  for (const cursor of ["01", "-1", 1, "secret", "1".repeat(21)])
    expect(phaseKey(`/observers/${id}/read`, { acknowledge_offset: cursor }, id)).toBeUndefined();
  expect(phaseKey("/secrets", {}, id)).toBeUndefined();
});
test("records have a strict bound, numeric phases, and no payload fields", async () => {
  vi.resetModules();
  vi.stubGlobal("__NAC_TERMINAL_PHASE_PROFILE__", true);
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(performance, "now").mockReturnValue(10);
  const { phaseRecord } = await import("./terminalPhaseProfile");
  phaseRecord("json", NaN, { observer: id, cursor: "0" });
  phaseRecord("json", 0, { observer: "secret", cursor: "0" });
  expect(log).not.toHaveBeenCalled();
  for (let i = 0; i < 2055; i++) phaseRecord("json", 0, { observer: id, cursor: "0" });
  expect(log).toHaveBeenCalledTimes(2049);
  const first = JSON.parse(String(log.mock.calls[0][0]).slice("NAC_TERMINAL_PHASE ".length));
  expect(first).toEqual({
    schema: 1,
    side: "client",
    phase: "json",
    seq: 0,
    at_us: 10000,
    elapsed_us: 10000,
    observer: id,
    cursor: "0",
  });
  expect(JSON.parse(String(log.mock.calls[2048][0]).slice("NAC_TERMINAL_PHASE ".length))).toEqual({
    schema: 1,
    side: "client",
    phase: "truncated",
    seq: 2048,
  });
});
test("disabled or failed numeric logging cannot change delivery", async () => {
  vi.resetModules();
  const log = vi.spyOn(console, "debug").mockImplementation(() => {
    throw Error("logger");
  });
  const { phaseRecord } = await import("./terminalPhaseProfile");
  phaseRecord("ack_ready", 0, { observer: id, cursor: "0" });
  expect(log).not.toHaveBeenCalled();
  vi.stubGlobal("__NAC_TERMINAL_PHASE_PROFILE__", true);
  expect(() => phaseRecord("ack_ready", 0, { observer: id, cursor: "0" })).not.toThrow();
});
