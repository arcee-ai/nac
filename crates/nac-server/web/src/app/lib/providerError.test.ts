import { describe, expect, it } from "vitest";

import { humanError } from "@/app/lib/providerError";

const INSUFFICIENT_CREDITS =
  'HTTP 402 from https://api.arcee.ai/api/v1/chat/completions: {"error":{"message":"Insufficient credits","code":"billing.insufficient_credits"}}';
const INVALID_KEY =
  'HTTP 401 from https://api.arcee.ai/api/v1/chat/completions: {"error":{"message":"Invalid or expired API key","code":"auth.invalid_api_key"}}';

describe("humanError for an Arcee login", () => {
  it("asks for a sign-in when no login is configured", () => {
    const error = new Error("Arcee auth is not configured. Run `nac arcee-auth login` to sign in.");

    expect(humanError(error, "arcee-auth").fix).toEqual({ kind: "login", label: "Sign in" });
  });

  it("asks for a sign-in again when the refresh was revoked", () => {
    const error = new Error(
      "Arcee authorization was revoked or expired; run `nac arcee-auth login` again.",
    );

    expect(humanError(error, "arcee-auth").fix).toEqual({ kind: "login", label: "Sign in again" });
  });

  it("asks for a sign-in again when the platform refuses the access token", () => {
    expect(humanError(INVALID_KEY, "arcee-auth").fix).toEqual({
      kind: "login",
      label: "Sign in again",
    });
  });

  it("puts a missing login ahead of a billing-shaped failure", () => {
    const notice = humanError(INSUFFICIENT_CREDITS, "arcee-auth", false);

    expect(notice.title).toBe("Not signed in to Arcee");
    expect(notice.fix).toEqual({ kind: "login", label: "Sign in" });
  });

  it("keeps credit guidance while signed in or before the login is known", () => {
    for (const signedIn of [true, null]) {
      const notice = humanError(INSUFFICIENT_CREDITS, "arcee-auth", signedIn);

      expect(notice.title).toBe("Not enough credits for this request");
      expect(notice.fix).toMatchObject({ kind: "link", label: "Open wallet" });
    }
  });
});

describe("humanError for an Arcee API key", () => {
  it("sends a rejected key to the settings", () => {
    expect(humanError(INVALID_KEY, "arcee-api").fix).toEqual({
      kind: "settings",
      label: "Open settings",
    });
  });

  it("keeps credit guidance whatever the login state", () => {
    const notice = humanError(INSUFFICIENT_CREDITS, "arcee-api", false);

    expect(notice.title).toBe("Not enough credits for this request");
    expect(notice.fix).toMatchObject({
      kind: "link",
      label: "Open wallet",
      url: "https://platform.arcee.ai/api/wallet",
    });
  });
});

it("names the account a signed-out ChatGPT login belongs to", () => {
  expect(humanError("HTTP 500 from upstream", "chatgpt-codex-responses", false).title).toBe(
    "Not signed in to ChatGPT",
  );
});
