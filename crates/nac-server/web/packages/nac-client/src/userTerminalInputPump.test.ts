import { describe, expect, it, vi } from "vitest";
import { TerminalInputUncertainError } from "./userTerminalConnection.js";
import { TerminalInputNotSentError, UserTerminalInputPump } from "./userTerminalInputPump.js";

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const first = deferred();
  const connection = {
    input: vi.fn(async (_bytes: Uint8Array, _signal?: AbortSignal) => {}),
    acknowledgeInputUncertainty: vi.fn(),
  };
  connection.input.mockImplementationOnce(() => first.promise);
  const pump = new UserTerminalInputPump(connection);
  return { first, connection, pump };
}

describe("bounded literal input pump", () => {
  it("keeps keyboard bytes ordered and coalesces pending inputs behind one active write", async () => {
    const f = fixture();
    const first = f.pump.send(Uint8Array.of(65));
    const second = f.pump.send(Uint8Array.of(66, 3));
    const third = f.pump.send(Uint8Array.of(27, 91, 50, 48, 48, 126));
    expect(f.connection.input).toHaveBeenCalledTimes(1);
    expect(f.pump.pendingBytes).toBe(8);
    f.first.resolve();
    await Promise.all([first, second, third]);
    expect(f.connection.input.mock.calls.map(([bytes]) => Array.from(bytes))).toEqual([
      [65],
      [66, 3, 27, 91, 50, 48, 48, 126],
    ]);
    expect(f.pump.pendingBytes).toBe(0);
    expect(f.pump.hasActiveInput).toBe(false);
  });

  it("bounds active and pending buffers independently and rejects overflow without dropping accepted bytes", async () => {
    const f = fixture();
    const first = f.pump.send(new Uint8Array(16_384).fill(65));
    const pending = f.pump.send(new Uint8Array(16_384).fill(66));
    await expect(f.pump.send(Uint8Array.of(67))).rejects.toThrow("buffer is full");
    expect(f.connection.input).toHaveBeenCalledTimes(1);
    expect(f.pump.pendingBytes).toBe(16_384);
    f.first.resolve();
    await Promise.all([first, pending]);
    expect(f.connection.input.mock.calls.map(([bytes]) => bytes.length)).toEqual([16_384, 16_384]);
    expect(f.connection.input.mock.calls[1][0].every((byte) => byte === 66)).toBe(true);
  });

  it("freezes after unconfirmed active delivery and explicitly rejects pending bytes as not sent", async () => {
    const f = fixture();
    const first = f.pump.send(Uint8Array.of(65));
    const pending = f.pump.send(Uint8Array.of(66));
    const firstRejected = expect(first).rejects.toBeInstanceOf(TerminalInputUncertainError);
    const pendingRejected = expect(pending).rejects.toBeInstanceOf(TerminalInputNotSentError);
    f.first.reject(new TerminalInputUncertainError(new TypeError("lost receipt")));
    await Promise.all([firstRejected, pendingRejected]);
    await expect(f.pump.send(Uint8Array.of(67))).rejects.toThrow("acknowledge");
    expect(f.connection.input).toHaveBeenCalledTimes(1);
    expect(f.pump.needsAcknowledgement).toBe(true);
    expect(f.pump.pendingBytes).toBe(0);
    f.pump.acknowledgeFailure();
    await f.pump.send(Uint8Array.of(68));
    expect(f.connection.input.mock.calls.map(([bytes]) => Array.from(bytes))).toEqual([[65], [68]]);
    expect(f.connection.acknowledgeInputUncertainty).toHaveBeenCalledTimes(1);
  });

  it("copies authorized bytes before waiting so caller mutation cannot change pending input", async () => {
    const f = fixture();
    const bytes = Uint8Array.of(65);
    const first = f.pump.send(bytes);
    bytes[0] = 90;
    const next = Uint8Array.of(66);
    const pending = f.pump.send(next);
    next[0] = 91;
    f.first.resolve();
    await Promise.all([first, pending]);
    expect(f.connection.input.mock.calls.map(([input]) => Array.from(input))).toEqual([[65], [66]]);
  });

  it("cancels the active request and rejects pending bytes immediately on disposal", async () => {
    const f = fixture();
    const first = f.pump.send(Uint8Array.of(65));
    const pending = f.pump.send(Uint8Array.of(66));
    const pendingRejected = expect(pending).rejects.toThrow("consumer closed");
    const signal = f.connection.input.mock.calls[0][1];
    f.pump.dispose();
    await pendingRejected;
    expect(signal?.aborted).toBe(true);
    f.first.resolve(); // Simulate a transport that completed before observing cancellation.
    await first;
    expect(f.connection.input).toHaveBeenCalledTimes(1);
    await expect(f.pump.send(Uint8Array.of(67))).rejects.toThrow("consumer closed");
  });

  it("rejects invalid size and prevents acknowledging an active operation", async () => {
    const f = fixture();
    await expect(f.pump.send(new Uint8Array(0))).rejects.toBeInstanceOf(TerminalInputNotSentError);
    await expect(f.pump.send(new Uint8Array(16_385))).rejects.toBeInstanceOf(
      TerminalInputNotSentError,
    );
    const first = f.pump.send(Uint8Array.of(65));
    expect(() => f.pump.acknowledgeFailure()).toThrow("active input receipt");
    f.first.resolve();
    await first;
  });
});
