import type { UserTerminalApi } from "./userTerminalApi.js";
import type { UserTerminalFrameResponse, UserTerminalResponse } from "./types.js";

export const NAC_TERMINAL_PROTOCOL_VERSION = 1 as const;
const MAX_PAGE = 65_536;
const MAX_INPUT = 16_384;
const MAX_CURSOR = 18_446_744_073_709_551_615n;

export class TerminalProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalProtocolError";
  }
}

export class TerminalInputUncertainError extends Error {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super("Terminal input delivery is unconfirmed. These bytes must not be retried automatically.");
    this.name = "TerminalInputUncertainError";
    this.cause = cause;
  }
}

export interface UserTerminalRenderer {
  /** Resolve only after the terminal parser has processed these literal bytes. */
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Resolve after clearing parser/screen state; never silently splice retained history. */
  reset(reason: "attach" | "reconnect" | "gap", signal: AbortSignal): Promise<void>;
}

export interface UserTerminalConnectionOptions {
  pageLimit?: number;
  waitMs?: number;
}

function requireVersion(value: number) {
  if (value !== NAC_TERMINAL_PROTOCOL_VERSION) {
    throw new TerminalProtocolError("Unsupported terminal protocol version");
  }
}
function cursor(value: string): bigint {
  if (value.length > 20 || !/^(0|[1-9][0-9]*)$/.test(value))
    throw new TerminalProtocolError("Invalid terminal cursor");
  const parsed = BigInt(value);
  if (parsed > MAX_CURSOR) throw new TerminalProtocolError("Terminal cursor exceeds u64");
  return parsed;
}
function bounded(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TerminalProtocolError(`Invalid ${label}`);
  }
}
function cancelled(signal: AbortSignal) {
  signal.throwIfAborted();
}
/** Stops waiting even if a renderer adapter ignores cancellation. Late completion cannot ACK. */
async function rendered(operation: Promise<void>, signal: AbortSignal) {
  cancelled(signal);
  let abort: () => void = () => {};
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
    cancelled(signal);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** One observer, one outstanding frame, and no queued input or automatic mutation retries. */
export class UserTerminalConnection {
  private readonly pageLimit: number;
  private readonly waitMs: number;
  private lifetime = new AbortController();
  private observer: string | undefined;
  private acknowledgement: { offset: string; reset: boolean } | undefined;
  private expectedOffset = "0";
  private reading = false;
  private attaching = false;
  private needsReset = false;
  private sendingInput = false;
  private inputUncertain = false;

  constructor(
    private readonly api: UserTerminalApi,
    readonly sessionId: string,
    readonly terminalId: string,
    private readonly renderer: UserTerminalRenderer,
    options: UserTerminalConnectionOptions = {},
  ) {
    this.pageLimit = options.pageLimit ?? MAX_PAGE;
    this.waitMs = options.waitMs ?? 1000;
    bounded(this.pageLimit, 1, MAX_PAGE, "terminal page limit");
    bounded(this.waitMs, 0, 1000, "terminal wait");
  }

  get observerId() {
    return this.observer;
  }
  get isInputUncertain() {
    return this.inputUncertain;
  }

  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([this.lifetime.signal, signal]) : this.lifetime.signal;
  }
  private status(terminal: UserTerminalResponse) {
    requireVersion(terminal.protocol_version);
    if (terminal.terminal_id !== this.terminalId)
      throw new TerminalProtocolError("Terminal identity changed");
  }

  async attach(signal?: AbortSignal, reason: "attach" | "reconnect" = "attach") {
    if (this.observer || this.attaching || this.reading)
      throw new TerminalProtocolError("Observer already active");
    this.attaching = true;
    if (this.lifetime.signal.aborted) this.lifetime = new AbortController();
    const active = this.signal(signal);
    try {
      cancelled(active);
      await rendered(this.renderer.reset(reason, active), active);
      const result = await this.api.attachUserTerminal(
        this.sessionId,
        this.terminalId,
        {
          protocol_version: NAC_TERMINAL_PROTOCOL_VERSION,
          page_limit: this.pageLimit,
        },
        active,
      );
      cancelled(active);
      requireVersion(result.protocol_version);
      this.status(result.terminal);
      if (!result.observer_id)
        throw new TerminalProtocolError("Missing terminal observer identity");
      this.observer = result.observer_id;
      this.acknowledgement = undefined;
      this.expectedOffset = "0";
      this.needsReset = false;
      return result.terminal;
    } finally {
      this.attaching = false;
    }
  }

  /** Expired observers require explicit reconnect and a renderer reset before replay. */
  async reconnect(signal?: AbortSignal) {
    await this.detach(signal);
    return this.attach(signal, "reconnect");
  }

  private validate(frame: UserTerminalFrameResponse, observer: string) {
    requireVersion(frame.protocol_version);
    this.status(frame.terminal);
    if (frame.observer_id !== observer)
      throw new TerminalProtocolError("Observer identity changed");
    const offset = cursor(frame.offset);
    const next = cursor(frame.next_offset);
    const start = cursor(frame.retained_start);
    const end = cursor(frame.retained_end);
    if (
      offset !== cursor(this.expectedOffset) ||
      start > end ||
      next > end ||
      frame.bytes.length > this.pageLimit ||
      frame.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      throw new TerminalProtocolError("Invalid terminal frame bounds or continuity");
    }
    if (frame.gap) {
      if (frame.bytes.length !== 0 || !frame.requires_ack || next !== start || offset >= start) {
        throw new TerminalProtocolError("Invalid terminal gap frame");
      }
    } else if (
      offset < start ||
      next !== offset + BigInt(frame.bytes.length) ||
      frame.requires_ack !== frame.bytes.length > 0
    ) {
      throw new TerminalProtocolError("Invalid terminal byte frame");
    }
    if (frame.caught_up !== (next === end))
      throw new TerminalProtocolError("Invalid terminal completion cursor");
  }

  async readNext(signal?: AbortSignal): Promise<UserTerminalFrameResponse> {
    const observer = this.observer;
    if (!observer || this.reading || this.needsReset)
      throw new TerminalProtocolError("Observer unavailable; reconnect before replay");
    this.reading = true;
    const active = this.signal(signal);
    try {
      cancelled(active);
      const frame = await this.api.pullUserTerminal(
        this.sessionId,
        this.terminalId,
        observer,
        {
          protocol_version: NAC_TERMINAL_PROTOCOL_VERSION,
          acknowledge_offset: this.acknowledgement?.offset,
          acknowledge_reset: this.acknowledgement?.reset ?? false,
          wait_ms: this.waitMs,
        },
        active,
      );
      cancelled(active);
      this.validate(frame, observer);
      try {
        if (frame.gap) await rendered(this.renderer.reset("gap", active), active);
        else if (frame.bytes.length)
          await rendered(this.renderer.write(Uint8Array.from(frame.bytes), active), active);
      } catch (error) {
        this.needsReset = true; // A cancelled/failed parser may have applied only part of a frame.
        throw error;
      }
      cancelled(active);
      if (frame.requires_ack) {
        this.acknowledgement = { offset: frame.next_offset, reset: frame.gap };
        this.expectedOffset = frame.next_offset;
      }
      return frame;
    } finally {
      this.reading = false;
    }
  }

  /** Runs until output EOF and final renderer ACK; failures stop without retry.
   * The returned status may still be alive: consumers continue separate status polling
   * until process exit rather than treating closed output as shell termination.
   */
  async run(signal?: AbortSignal, onFrame?: (frame: UserTerminalFrameResponse) => void) {
    for (;;) {
      const frame = await this.readNext(signal);
      onFrame?.(frame);
      if (frame.terminal.output_complete && frame.caught_up && !frame.requires_ack)
        return frame.terminal;
    }
  }

  /** Detaches observation only. Closing the process uses the separate terminateTerminal API. */
  async detach(signal?: AbortSignal) {
    const observer = this.observer;
    this.observer = undefined;
    this.lifetime.abort(new DOMException("Terminal observation detached", "AbortError"));
    if (observer)
      await this.api.detachUserTerminal(this.sessionId, this.terminalId, observer, signal);
  }

  async input(bytes: Uint8Array, signal?: AbortSignal) {
    bounded(bytes.length, 1, MAX_INPUT, "terminal input length");
    if (this.inputUncertain) throw new TerminalInputUncertainError(undefined);
    if (this.sendingInput)
      throw new TerminalProtocolError("Terminal input already in flight; input was not queued");
    const active = this.signal(signal);
    cancelled(active);
    this.sendingInput = true;
    try {
      await this.api.inputUserTerminal(
        this.sessionId,
        this.terminalId,
        {
          protocol_version: NAC_TERMINAL_PROTOCOL_VERSION,
          bytes: Array.from(bytes),
        },
        active,
      );
    } catch (error) {
      this.inputUncertain = true;
      throw new TerminalInputUncertainError(error);
    } finally {
      this.sendingInput = false;
    }
  }

  /** Explicit consumer acknowledgement enables fresh input; previously sent bytes are never replayed. */
  acknowledgeInputUncertainty() {
    this.inputUncertain = false;
  }

  async resize(cols: number, rows: number, signal?: AbortSignal) {
    bounded(cols, 2, 500, "terminal columns");
    bounded(rows, 1, 300, "terminal rows");
    const active = this.signal(signal);
    cancelled(active);
    await this.api.resizeUserTerminal(
      this.sessionId,
      this.terminalId,
      {
        protocol_version: NAC_TERMINAL_PROTOCOL_VERSION,
        cols,
        rows,
      },
      active,
    );
  }
}
