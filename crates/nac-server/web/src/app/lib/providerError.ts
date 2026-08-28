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

import { isJsonObject } from "@/app/lib/json";
import type { JsonValue } from "@/app/lib/json";
import { isString } from "@/app/lib/primitive";

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
export type RunError = Error | string | { status?: unknown } | null | undefined;

/**
 * Decode a caught value into the failure domain at the catch boundary, so the
 * rest of the app never has to branch on an unparsed `unknown`.
 */
export function toRunError(cause: unknown): RunError {
  if (cause instanceof Error) return cause;
  if (cause === null || cause === undefined) return cause;
  if (isString(cause)) return cause;
  if (Object(cause) === cause) {
    // SAFETY: this branch is reached only when cause is a non-null object
    // (Object() is the identity on objects and boxes primitives), so reading
    // its optional status property is sound.
    return { status: (cause as { status?: unknown }).status };
  }
  return String(cause);
}

/** Wallet page of the platform, where credits are topped up. */
const WALLET_PATH = "/api/wallet";
const WORKSPACE_SETTINGS_PATH = "/admin/workspace/workspace-settings";
const PLATFORM_HOST = "platform.arcee.ai";

function rawMessage(error: RunError): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Platform page matching the API host the request went to, so a session against
 * a dev origin is not sent to production: `api2.apps.dev.arcee.ai` answers on
 * `platform2.apps.dev.arcee.ai`, the same pairing the platform redirects on.
 */
function platformUrl(raw: string, path: string): string {
  const found = raw.match(/https:\/\/[^\s"'),]+/);
  let host = PLATFORM_HOST;
  if (found) {
    try {
      const { hostname } = new URL(found[0]);
      if (hostname.endsWith(".arcee.ai") && /^api\d*\./.test(hostname)) {
        host = hostname.replace(/^api(\d*)\./, "platform$1.");
      }
    } catch {
      // Not a URL after all; the production host is the safer guess.
    }
  }
  return `https://${host}${path}`;
}

/**
 * Status codes named anywhere in the text: the provider's own (`HTTP 402 from
 * …`, `(401 Unauthorized)`, `"code": 402`) alongside the status of the nac
 * request that carried it, which for a provider failure is only ever the
 * outermost one (a rejected login reaches the browser as 502).
 */
function statusCodes(raw: string, status: number | null): Set<number> {
  const codes = new Set<number>();
  for (const pattern of [
    /HTTP (\d{3})/g,
    /\((\d{3}) [A-Z]/g,
    /"code":\s*(\d{3})/g,
    /status[ _]code["']?[:=]\s*(\d{3})/gi,
  ]) {
    for (const match of raw.matchAll(pattern)) codes.add(Number(match[1]));
  }
  if (status !== null) codes.add(status);
  return codes;
}

/**
 * The provider's sentence, dug out of whatever envelope carried it: the
 * OpenAI-compatible `{ error: { message } }` of the inference API or the
 * `{ detail }` of the platform's own routes, either of which may itself have
 * been truncated mid-JSON on the way here.
 */
function providerMessage(raw: string): string {
  const start = raw.indexOf("{");
  if (start === -1) return raw;
  const body = raw.slice(start);
  const message = parsedMessage(body) ?? truncatedMessage(body);
  if (message === null) return raw;
  const prefix = raw.slice(0, start).trim().replace(/:$/, "");
  // Keep the request line ahead of the provider's own words when there is one,
  // so an unrecognised failure can still be traced back to its call.
  return prefix ? `${prefix} — ${message}` : message;
}

function parsedMessage(body: string): string | null {
  try {
    return nestedMessage(JSON.parse(body));
  } catch {
    return null;
  }
}

/**
 * The message of a body that was cut off before its JSON closed — the run
 * transcript caps a provider error at 600 bytes, which lands mid-string often
 * enough to be worth reading anyway.
 */
function truncatedMessage(body: string): string | null {
  const found = body.match(/"(?:message|detail|error_description)"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!found) return null;
  try {
    // SAFETY: the capture is the inside of a JSON string literal, so wrapping
    // it back in quotes and parsing always yields the original string.
    return JSON.parse(`"${found[1]}"`) as string;
  } catch {
    return found[1];
  }
}

function nestedMessage(value: JsonValue): string | null {
  if (isString(value)) return value;
  if (!isJsonObject(value)) return null;
  for (const key of ["message", "detail", "error", "error_description"]) {
    const found = nestedMessage(value[key]);
    if (found !== null) return found;
  }
  return null;
}

/** Copy shared by the two ways a login stops working. */
const SIGN_IN_AGAIN: HumanError = {
  title: "There was a problem with authentication",
  description: "Please sign back in to continue using the API.",
  fix: { kind: "login", label: "Sign in again" },
};

/**
 * The failure as the user should read it. `backend` decides which credential an
 * authentication failure is about — a stored login is fixed by signing in
 * again, an API key by pasting a working one — and can be left out where the
 * session is not known.
 */
export function humanError(error: RunError, backend?: string | null): HumanError {
  const raw = rawMessage(error);
  const status = hasStatus(error) ? error.status : null;
  const text = raw.toLowerCase();
  const has = (...needles: string[]) => needles.some((needle) => text.includes(needle));
  const codes = statusCodes(raw, status);

  // nac's own configuration errors say exactly what is wrong with the setup,
  // which is more than any rewrite could, so they are only framed.
  const invalidConfig = raw.match(/invalid model configuration:\s*(.+)/is);
  if (invalidConfig) {
    return {
      title: "Configuration needs repair",
      description: sentence(invalidConfig[1]),
      fix: { kind: "settings", label: "Open settings" },
    };
  }

  // Billing is asked before credentials: a request that ran out of credits was
  // authenticated perfectly well, and its body still names the key that paid.
  // HTTP 402 / insufficient_credits is also the platform reserving against
  // catalog max_tokens when the remaining balance cannot cover that hold
  // (issue #219) — the wallet can still show a positive amount.
  if (has("hard_limit_exceeded", "hard limit exceeded")) {
    return {
      title: "Spending limit reached",
      description:
        "This request would take the workspace below its hard limit. Raise the limit or reduce usage to continue.",
      fix: {
        kind: "link",
        label: "Open Workspace Settings",
        url: platformUrl(raw, WORKSPACE_SETTINGS_PATH),
      },
    };
  }
  if (
    has(
      "insufficient_credits",
      "insufficient credits",
      "insufficient_quota",
      "top up your wallet",
    ) ||
    codes.has(402)
  ) {
    return {
      title: "Not enough credits for this request",
      description:
        "The provider reserved more than the remaining balance allows. The wallet can still show a balance. Top up, or retry.",
      fix: {
        kind: "link",
        label: "Open wallet",
        url: platformUrl(raw, WALLET_PATH),
      },
    };
  }

  if (has("arcee auth is not configured")) {
    return {
      title: "Not signed in to Arcee",
      description: "Sign in to continue using the API.",
      fix: { kind: "login", label: "Sign in" },
    };
  }
  const keyRejected = has(
    "rejected this api key",
    "invalid or expired api key",
    "auth.invalid_api_key",
    "auth.missing_bearer",
    "missing or invalid authorization header",
  );
  const authFailed =
    keyRejected ||
    has(
      "arcee authorization was revoked",
      "arcee token refresh failed",
      "rejected this login",
      "authentication_error",
    ) ||
    codes.has(401);
  if (authFailed) {
    // A key is replaced in the settings; a stored login is signed in again.
    if (keyRejected || backend === "arcee-api") {
      return {
        title: "There was a problem with authentication",
        description: "The API key was rejected. Add a valid Arcee API key to continue.",
        fix: { kind: "settings", label: "Open settings" },
      };
    }
    return SIGN_IN_AGAIN;
  }
  if (has("permission_error") || codes.has(403)) {
    return {
      title: "This account is not allowed to do that",
      description: "Ask the workspace owner for access, or pick a model the account can use.",
      fix: { kind: "settings", label: "Open settings" },
    };
  }

  if (has("rate_limit", "rate limit exceeded") || codes.has(429)) {
    return {
      title: "Rate limit reached",
      description: has("token")
        ? "The token rate limit for this account is used up. Wait a moment and try again."
        : "Arcee is throttling requests for this account. Wait a moment and try again.",
      fix: { kind: "retry", label: "Try again" },
    };
  }

  if (
    has("context_window_exceeded", "context window exceeded", "context length", "maximum context")
  ) {
    return {
      title: "The conversation is too long",
      description: "Compact the context with /compact, or start a new session to continue.",
    };
  }
  if (has("content_policy_blocked", "content policy")) {
    return {
      title: "Blocked by the content policy",
      description: "The provider refused this request. Rephrase and try again.",
    };
  }
  if (
    has(
      "model.not_accessible",
      "not accessible with the current access profile",
      "model_not_found",
      "the requested model",
    )
  ) {
    return {
      title: "This model is not available",
      description: "The account cannot use the selected model. Pick a different one to continue.",
      fix: { kind: "settings", label: "Open settings" },
    };
  }
  if (has("provider.unprocessable") || codes.has(422)) {
    return {
      title: "The request was rejected",
      description: "One or more request parameters are invalid or out of range.",
    };
  }

  if (
    has("could not reach the provider", "failed to refresh arcee access token") ||
    has("failed to fetch", "load failed", "networkerror", "err_connection")
  ) {
    return {
      title: "Cannot reach Arcee",
      description: "Check the connection and try again.",
      fix: { kind: "retry", label: "Try again" },
    };
  }
  if (
    has("internal.unexpected", "service_unavailable", "api_error") ||
    [500, 502, 503, 504].some((code) => codes.has(code))
  ) {
    return {
      title: "Arcee is having trouble",
      description: "The provider returned a server error. Try again in a moment.",
      fix: { kind: "retry", label: "Try again" },
    };
  }

  // nac reduces an agent failure to these two before it leaves the server, so
  // there is nothing to quote and the log is the only place left to look.
  if (text === "operation failed" || text === "run failed") {
    return {
      title: "The run could not finish",
      description: "Check the command log for what the agent was doing.",
      fix: { kind: "retry", label: "Try again" },
    };
  }

  return { title: sentence(providerMessage(raw)) };
}

/** One line for a toast, footer, or hint, where there is no room for a fix. */
export function humanErrorText(error: RunError, backend?: string | null): string {
  const { title, description } = humanError(error, backend);
  return description ? `${title}. ${description}` : title;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function isStatusPayload(error: RunError): error is { status?: unknown } {
  return error !== null && error !== undefined && !(error instanceof Error) && !isString(error);
}

function hasStatus(error: RunError): error is { status: number } {
  if (!isStatusPayload(error)) return false;
  return Number.isFinite(error.status);
}
