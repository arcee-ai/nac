import { TerminalInputUncertainError, } from "./userTerminalConnection.js";
const LIMIT = 16_384;
export class TerminalInputNotSentError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = "TerminalInputNotSentError";
        this.cause = cause;
    }
}
/** Ordered keyboard/paste pump: one active write and one coalescing pending 16 KiB buffer.
 * Failed active delivery discards pending bytes with explicit not-sent receipts.
 * It never retries bytes or silently resumes after uncertain delivery.
 */
export class UserTerminalInputPump {
    connection;
    abort = new AbortController();
    signal;
    cancelListener;
    pending;
    active = false;
    failed;
    disposed = false;
    constructor(connection, signal) {
        this.connection = connection;
        this.signal = signal ? AbortSignal.any([this.abort.signal, signal]) : this.abort.signal;
        this.cancelListener = () => {
            this.disposed = true;
            this.rejectPending(new TerminalInputNotSentError("Terminal input was not sent because its consumer closed", this.signal.reason));
        };
        this.signal.addEventListener("abort", this.cancelListener, { once: true });
        if (this.signal.aborted)
            this.cancelListener();
    }
    get pendingBytes() {
        return this.pending?.length ?? 0;
    }
    get hasActiveInput() {
        return this.active;
    }
    get needsAcknowledgement() {
        return this.failed !== undefined;
    }
    send(bytes) {
        if (bytes.length === 0 || bytes.length > LIMIT) {
            return Promise.reject(new TerminalInputNotSentError("Terminal input was not sent: each input must contain 1–16384 bytes"));
        }
        if (this.disposed)
            return Promise.reject(new TerminalInputNotSentError("Terminal input was not sent because its consumer closed"));
        if (this.failed !== undefined)
            return Promise.reject(new TerminalInputNotSentError("Terminal input was not sent: acknowledge the preceding delivery failure first", this.failed));
        if (this.active && this.pendingBytes + bytes.length > LIMIT) {
            return Promise.reject(new TerminalInputNotSentError("Terminal input was not sent because the pending 16 KiB buffer is full"));
        }
        return new Promise((resolve, reject) => {
            const receipt = { resolve, reject };
            if (!this.active) {
                this.active = true;
                void this.deliver({ bytes: bytes.slice(), receipts: [receipt] });
            }
            else {
                this.pending ??= { buffer: new Uint8Array(LIMIT), length: 0, receipts: [] };
                this.pending.buffer.set(bytes, this.pending.length);
                this.pending.length += bytes.length;
                this.pending.receipts.push(receipt);
            }
        });
    }
    rejectPending(error) {
        const pending = this.pending;
        this.pending = undefined;
        for (const receipt of pending?.receipts ?? [])
            receipt.reject(error);
    }
    async deliver(batch) {
        try {
            await this.connection.input(batch.bytes, this.signal);
            for (const receipt of batch.receipts)
                receipt.resolve();
        }
        catch (error) {
            this.failed = error ?? new Error("Terminal input delivery failed");
            const activeError = error instanceof TerminalInputUncertainError
                ? error
                : new TerminalInputNotSentError("Terminal input was not sent", error);
            for (const receipt of batch.receipts)
                receipt.reject(activeError);
            this.rejectPending(new TerminalInputNotSentError("Pending terminal input was not sent after the preceding delivery failed", error));
        }
        finally {
            this.active = false;
        }
        if (this.pending && !this.disposed && this.failed === undefined) {
            const pending = this.pending;
            this.pending = undefined;
            this.active = true;
            void this.deliver({
                bytes: pending.buffer.slice(0, pending.length),
                receipts: pending.receipts,
            });
        }
    }
    /** Enables only fresh input after an explicit consumer decision; discarded bytes stay discarded. */
    acknowledgeFailure() {
        if (this.active)
            throw new TerminalInputNotSentError("Wait for the active input receipt before acknowledging its outcome");
        this.failed = undefined;
        this.connection.acknowledgeInputUncertainty();
    }
    dispose() {
        this.abort.abort(new DOMException("Terminal input consumer closed", "AbortError"));
        this.signal.removeEventListener("abort", this.cancelListener);
    }
}
