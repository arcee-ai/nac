import type { Page, Route } from "@playwright/test";

import type { ManagedAuthProvider, ManagedAuthStatus } from "../src/app/types/api";

/** Visibly fake; no real provider ever issues or sees this code. */
export const FAKE_DEVICE_CODE = "FAKE-0550";

/**
 * Provider device authorization is an external OAuth boundary, so the browser
 * journey observes deterministic account outcomes at the NAC routes instead.
 * The login list can be held unanswered to show the checking state, and an
 * issued login completes only when the test approves it, so every state the
 * UI distinguishes is reachable on purpose rather than by timing.
 */
export class ProviderDeviceAuthDouble {
  readonly signedIn: Record<ManagedAuthProvider, boolean> = {
    arcee: false,
    codex: false,
  };
  readonly starts: ManagedAuthProvider[] = [];
  readonly logouts: ManagedAuthProvider[] = [];
  private approved = false;
  private held: Array<() => void> = [];
  private holding = false;

  private constructor(private readonly baseUrl: string) {}

  static async install(page: Page, baseUrl: string): Promise<ProviderDeviceAuthDouble> {
    const double = new ProviderDeviceAuthDouble(baseUrl);
    await page.route(`${baseUrl}/auth`, (route) => double.list(route));
    await page.route(new RegExp(`^${escape(baseUrl)}/auth/(arcee|codex)(/.*)?$`), (route) =>
      double.account(route),
    );
    await page.route(`${baseUrl}/providers/models`, (route) => double.models(route));
    return double;
  }

  /** Leaves later login-list requests unanswered until `releaseCheck`. */
  holdCheck(): void {
    this.holding = true;
  }

  releaseCheck(): void {
    this.holding = false;
    for (const release of this.held.splice(0)) release();
  }

  /** The provider accepts the issued code on its own page. */
  approve(): void {
    this.approved = true;
  }

  private status(provider: ManagedAuthProvider): ManagedAuthStatus {
    const signedIn = this.signedIn[provider];
    return {
      provider,
      backend: provider === "arcee" ? "arcee-auth" : "chatgpt-codex-responses",
      base_url: null,
      signed_in: signedIn,
      account: signedIn ? `${provider}@example.test` : null,
      organization: null,
      expires_at_ms: null,
      path: `/server-owned/${provider}.json`,
    };
  }

  private async list(route: Route) {
    if (this.holding) await new Promise<void>((resolve) => this.held.push(resolve));
    await route.fulfill({
      json: { providers: [this.status("arcee"), this.status("codex")] },
    });
  }

  private async account(route: Route) {
    const url = new URL(route.request().url());
    const [, , provider, step, loginId] = url.pathname.split("/") as [
      string,
      string,
      ManagedAuthProvider,
      string | undefined,
      string | undefined,
    ];
    const method = route.request().method();
    if (step === undefined && method === "DELETE") {
      this.logouts.push(provider);
      this.signedIn[provider] = false;
      return route.fulfill({ json: this.status(provider) });
    }
    if (step === "login" && loginId === undefined && method === "POST") {
      this.starts.push(provider);
      this.approved = false;
      return route.fulfill({
        json: {
          provider,
          login_id: `${provider}-e2e-login`,
          verification_uri: `${this.baseUrl}/health`,
          user_code: FAKE_DEVICE_CODE,
          expires_in_secs: 600,
        },
      });
    }
    if (step === "login" && loginId && method === "GET") {
      if (!this.approved) return route.fulfill({ json: { state: "pending" } });
      this.signedIn[provider] = true;
      return route.fulfill({
        json: { state: "complete", auth: this.status(provider) },
      });
    }
    if (step === "login" && loginId && method === "DELETE")
      return route.fulfill({ status: 204, body: "" });
    return route.continue();
  }

  private async models(route: Route) {
    const backend = route.request().postDataJSON().backend;
    if (backend !== "chatgpt-codex-responses" && backend !== "arcee-auth") return route.continue();
    await route.fulfill({
      json: {
        base_url: "https://example.test/backend-api",
        models: [{ id: "codex-e2e-fixture", display_name: "Codex e2e fixture" }],
        api_key_env: null,
      },
    });
  }
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
