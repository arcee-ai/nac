import { describe, expect, it } from "vitest";

import {
  cloneIsRunning,
  managedSecretNameError,
  repositoryIdentity,
} from "@/app/features/managed/model";
import type { ManagedCloneOperation } from "@/app/types/api";

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
});
