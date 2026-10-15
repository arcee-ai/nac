import { expect, it } from "vitest";
import {
  publicProjectView,
  publicSessionView,
  comparePresentationOrder,
  requireNativeSummary,
  requireNativeProject,
} from "./collectionViews";
import { projectEntries, sameSessionLocation, projectLocationPayload } from "@/app/lib/projects";
import { formatCostMicros, formatTokensCompact, sessionEnvLabel } from "@/app/lib/format";
import type {
  PublicNacProject,
  PublicNacSessionSummary,
} from "../../../../packages/nac-client/src/publicNative.generated.js";

const project: PublicNacProject = {
  project_id: "project",
  name: "Public project",
  description: null,
  pinned: false,
  presentation_version: "9223372036854775807",
  sort_order: "-9223372036854775808",
  default_model_config_id: null,
};
const summary: PublicNacSessionSummary = {
  session_id: "session",
  title: "Public session",
  model: "model",
  behavior: "direct",
  project_id: "project",
  pinned: false,
  sort_order: "9007199254740993",
  presentation_version: "9223372036854775807",
  run_count: "1",
  visible_message_count: "1",
  total_tokens: "18446744073709551615",
  total_cost_micros: "18446744073709551615",
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T01:00:00Z",
};

it("keeps exact public DTO fields without inventing raw private or activity data", () => {
  const view = publicSessionView(summary);
  expect(view.summary.presentation_version).toBe("9223372036854775807");
  expect(view.summary.total_tokens).toBe("18446744073709551615");
  expect(Object.keys(view)).toEqual(["summary"]);
  for (const key of ["backend", "cwd", "sandboxed", "ssh_host", "last_user_prompt"])
    expect(key in view.summary).toBe(false);
  const publicProject = publicProjectView(project);
  for (const key of ["cwd", "ssh_host", "ssh_identity_file", "created_at", "updated_at"])
    expect(key in publicProject).toBe(false);
  expect(sessionEnvLabel(view.summary)).toBeNull();
  expect(() => requireNativeSummary(view.summary)).toThrow();
  expect(() => requireNativeProject(publicProject)).toThrow();
});

it("orders signed exact tokens without rounding adjacent values above the safe range", () => {
  expect(comparePresentationOrder("9007199254740992", "9007199254740993")).toBe(-1);
  expect(comparePresentationOrder("-9223372036854775808", "0")).toBe(-1);
  expect(comparePresentationOrder("9223372036854775807", "9223372036854775807")).toBe(0);
  expect(comparePresentationOrder(2, 1)).toBe(1);
});

it("derives display totals with bigint while preserving atomic wire strings", () => {
  const views = [
    publicSessionView(summary),
    publicSessionView({ ...summary, session_id: "second" }),
  ];
  const entry = projectEntries([publicProjectView(project)], views)[0];
  expect(entry.totalCostMicros).toBe(36893488147419103230n);
  expect(formatCostMicros(entry.totalCostMicros)).toBe("$36893488147419.10");
  expect(formatCostMicros(summary.total_cost_micros)).toBe("$18446744073709.55");
  expect(formatTokensCompact(summary.total_tokens)).toBe("18446744073710M");
  expect(views[0].summary.total_cost_micros).toBe("18446744073709551615");
});

it("does not turn unknown spend/time/location into zero, a timestamp or a matching workspace", () => {
  const empty = projectEntries([publicProjectView(project)], [])[0];
  expect(empty.updatedAt).toBeNull();
  const unknown = projectEntries(
    [publicProjectView(project)],
    [publicSessionView({ ...summary, total_cost_micros: null })],
  )[0];
  expect(unknown.totalCostMicros).toBeNull();
  expect(sameSessionLocation(publicProjectView(project), publicSessionView(summary).summary)).toBe(
    false,
  );
  expect(() => projectLocationPayload(publicSessionView(summary).summary)).toThrow();
});
