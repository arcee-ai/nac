/**
 * Provider failures rewritten in the words of the person who has to act on them.
 *
 * There are no error codes to switch on. A provider's own JSON arrives embedded
 * in a Rust format string — `crates/nac-core/src/model/client/mod.rs` builds
 * `HTTP {status} from {url}: {body}` — and the rest of the failures are prose
 * from `nac-core`, so recognising one means matching what its text contains.
 * The codes matched below are the Arcee platform's own (`billing.*`, `auth.*`,
 * `rate_limit.*`, `provider.*`) and the copy follows the platform's wording, so
 * the same failure reads the same in both apps.
 *
 * An unrecognised failure keeps the provider's message rather than being
 * flattened into a generic apology; only the envelope around it is stripped.
 */
/** What the surface showing the error can offer to do about it. */
export interface ErrorFix {
    label: string;
    kind: "login" | "settings" | "retry" | "link";
    /** Set for `link` fixes: a page on the Arcee platform. */
    url?: string;
}
export interface HumanError {
    title: string;
    description?: string;
    fix?: ErrorFix;
}
/**
 * A failure as it reaches the UI: an `Error`, prose, or a payload carrying a
 * status code. `null`/`undefined` stand for "no failure".
 */
export type RunError = Error | string | {
    status?: unknown;
} | null | undefined;
/**
 * Decode a caught value into the failure domain at the catch boundary, so the
 * rest of the app never has to branch on an unparsed `unknown`.
 */
export declare function toRunError(cause: unknown): RunError;
/**
 * The failure as the user should read it. `backend` decides which credential an
 * authentication failure is about — a stored login is fixed by signing in
 * again, an API key by pasting a working one — and can be left out where the
 * session is not known.
 */
export declare function humanError(error: RunError, backend?: string | null): HumanError;
/** One line for a toast, footer, or hint, where there is no room for a fix. */
export declare function humanErrorText(error: RunError, backend?: string | null): string;
