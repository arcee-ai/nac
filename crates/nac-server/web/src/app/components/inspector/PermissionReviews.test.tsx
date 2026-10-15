/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import type { PermissionReview } from "@/app/types/api";

import { PermissionReviewStatus } from "./PermissionReviews";

afterEach(cleanup);

const review: PermissionReview = {
  id: "review",
  session_id: "session",
  tool: "read",
  backend: "local",
  resources: [],
  user_authorized_retry: false,
  reviewer: "jev:typesafe/jev-1.13",
  created_at_epoch_ms: 1,
};

it("distinguishes an enabled policy from checked service availability", () => {
  render(<PermissionReviewStatus reviews={[]} />);
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("Service availability not checked");
  expect(status.textContent).toContain("checks credentials only");
  expect(status.textContent).toContain("Model access, credits and connectivity");
});

it.each([
  ["authentication", "Sign in to Arcee again"],
  ["access_denied", "check its access settings"],
  ["model_unavailable", "model registration, API availability and workspace access"],
  ["insufficient_credits", "insufficient credits for review"],
  ["rate_limited", "rate limited"],
  ["timeout", "did not answer in time"],
  ["invalid_response", "invalid response"],
  ["service_unavailable", "could not be reached"],
  ["cancelled", "cancelled before a verdict was used"],
] satisfies [NonNullable<PermissionReview["failure_reason"]>, string][])(
  "explains %s without claiming that an action ran or opening manual approval",
  (reason, explanation) => {
    render(
      <PermissionReviewStatus
        reviews={[{ ...review, outcome: "unavailable", failure_reason: reason }]}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Last review unavailable");
    expect(status.textContent).toContain(explanation);
    expect(status.textContent).toContain("That action was not executed");
    expect(status.textContent).toContain("switch to Manual");
    expect(status.textContent).not.toMatch(/jev/i);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("keeps older failures readable without a classified reason", () => {
  render(<PermissionReviewStatus reviews={[{ ...review, outcome: "unavailable" }]} />);
  expect(screen.getByRole("status").textContent).toContain("check server diagnostics");
});

it("describes the latest completed review without promising future availability", () => {
  render(
    <PermissionReviewStatus
      reviews={[
        { ...review, outcome: "approved", created_at_epoch_ms: 2 },
        { ...review, outcome: "unavailable" },
      ]}
    />,
  );
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("Last review completed");
  expect(status.textContent).toContain("availability can change");
  expect(status.textContent).not.toContain("Last review unavailable");
});

it("shows an in-progress review as unexecuted", () => {
  render(<PermissionReviewStatus reviews={[review]} />);
  expect(screen.getByRole("status").textContent).toContain("Review in progress");
  expect(screen.getByRole("status").textContent).toContain("has not run");
});
