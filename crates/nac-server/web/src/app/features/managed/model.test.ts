import { describe, expect, it } from "vitest";

import {
  cloneIsRunning,
  managedModelPick,
  managedSecretNameError,
  matchesManagedModelPick,
  repositoryIdentity,
} from "@/app/features/managed/model";
import type { ManagedCloneOperation, ManagedHostStatus } from "@/app/types/api";

const managedModelStatus = {
  model_ready: true,
  model: {
    backend: "arcee-api",
    id: "trinity-large-thinking",
    endpoint: "https://api.arcee.ai/api/v1",
    display_name: "Managed Arcee",
  },
} as ManagedHostStatus;

describe("managed feature model", () => {
  it("keeps reserved and malformed secret names out of the generic store", () => {
    expect(managedSecretNameError("SERVICE_TOKEN")).toBe("");
    expect(managedSecretNameError("9TOKEN")).toContain("first character");
    expect(managedSecretNameError("GITHUB_TOKEN")).toContain("managed by NAC");
  });

  it("accepts only owner/repository identities", () => {
    expect(repositoryIdentity("openai/nac")).toEqual(["openai", "nac"]);
    expect(repositoryIdentity("nac")).toBeNull();
    expect(repositoryIdentity("openai/nac/extra")).toBeNull();
  });

  it("recognizes only the durable running clone state", () => {
    expect(cloneIsRunning(null)).toBe(false);
    expect(cloneIsRunning({ status: "running" } as ManagedCloneOperation)).toBe(true);
    expect(cloneIsRunning({ status: "completed" } as ManagedCloneOperation)).toBe(false);
  });

  it("projects and exactly matches the managed host model profile", () => {
    const pick = managedModelPick(managedModelStatus);
    expect(pick).toEqual({
      backend: "arcee-api",
      model: "trinity-large-thinking",
      baseUrl: "https://api.arcee.ai/api/v1",
    });
    if (!pick) throw new Error("managed status should produce a model pick");
    expect(matchesManagedModelPick(managedModelStatus, pick)).toBe(true);
    expect(matchesManagedModelPick(managedModelStatus, { ...pick, model: "other" })).toBe(false);
    expect(managedModelPick(null)).toBeNull();
  });
});
