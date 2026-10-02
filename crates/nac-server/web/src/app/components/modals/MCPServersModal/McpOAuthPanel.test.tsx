/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpOAuthPanel } from "@/app/components/modals/MCPServersModal/McpOAuthPanel";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MCP OAuth controls", () => {
  it("shows the CIMD support assertion in metadata override guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "needs_configuration" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    render(<McpOAuthPanel serverName="slack" />);
    await screen.findByText("Not configured");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "client_metadata" },
    });

    expect(
      screen.getByPlaceholderText(
        '{"authorization_endpoint":"https://…","token_endpoint":"https://…","client_id_metadata_document_supported":true}',
      ),
    ).toBeTruthy();
  });

  it("configures protected credential references without rendering them afterward", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "needs_configuration" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "needs_authorization" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

    render(<McpOAuthPanel serverName="slack" />);
    await screen.findByText("Not configured");

    fireEvent.change(screen.getByPlaceholderText("SLACK_MCP_CLIENT_ID"), {
      target: { value: "SLACK_CLIENT_ID_REF" },
    });
    fireEvent.change(screen.getByPlaceholderText("SLACK_MCP_CLIENT_SECRET"), {
      target: { value: "SLACK_CLIENT_SECRET_REF" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Configure OAuth" }));

    await screen.findByRole("button", { name: "Authenticate" });
    expect(fetch).toHaveBeenLastCalledWith(
      "/mcp_library/servers/slack/oauth/configure",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          registration: {
            type: "pre_registered",
            client_id_credential: "SLACK_CLIENT_ID_REF",
            client_secret_credential: "SLACK_CLIENT_SECRET_REF",
          },
          scopes: ["channels:history", "chat:write"],
        }),
      }),
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue("SLACK_CLIENT_ID_REF")).toBeNull();
      expect(screen.queryByDisplayValue("SLACK_CLIENT_SECRET_REF")).toBeNull();
    });
  });

  it("keeps polling through connecting status and transient failures until connected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "needs_authorization" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "connecting",
            authorization_url: "https://slack.example.test/authorize",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "connecting" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockRejectedValueOnce(new Error("temporary status failure"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "connected" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

    render(<McpOAuthPanel serverName="slack" />);
    await screen.findByRole("button", { name: "Authenticate" });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Waiting for authorization")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("Waiting for authorization")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("OAuth status is temporarily unavailable. Retrying…")).toBeTruthy();
    expect(screen.getByText("Waiting for authorization")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("polls while connected to surface a transport-requested scope upgrade", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "connected" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "connected",
            authorization_url: "https://slack.example.test/authorize?scope=channels%3Awrite",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    render(<McpOAuthPanel serverName="slack" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Connected")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      screen.getByRole("link", { name: "Continue OAuth authorization" }).getAttribute("href"),
    ).toBe("https://slack.example.test/authorize?scope=channels%3Awrite");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears a stale authorization link after reconfiguration", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "connected",
            authorization_url: "https://slack.example.test/authorize?scope=channels%3Awrite",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "needs_authorization" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

    render(<McpOAuthPanel serverName="slack" />);
    await screen.findByRole("link", { name: "Continue OAuth authorization" });
    fireEvent.click(screen.getByRole("button", { name: "Edit OAuth configuration" }));
    fireEvent.change(screen.getByPlaceholderText("SLACK_MCP_CLIENT_ID"), {
      target: { value: "SLACK_CLIENT_ID_REF" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Configure OAuth" }));

    await screen.findByRole("button", { name: "Authenticate" });
    expect(screen.queryByRole("link", { name: "Continue OAuth authorization" })).toBeNull();
  });
});
