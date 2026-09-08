import { describe, expect, it } from "vitest";

import {
  cloneIsRunning,
  managedModelPick,
  managedSecretNameError,
  matchesManagedModelPick,
  readyManagedModelRequests,
  repositoryIdentity,
} from "@/app/features/managed/model";
import type { ManagedCloneOperation, ManagedHostStatus, ModelCatalog } from "@/app/types/api";

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

  it("keeps the deployment default but shares its credential across models at the destination", () => {
    const pick = managedModelPick(managedModelStatus);
    expect(pick).toEqual({
      backend: "arcee-api",
      model: "trinity-large-thinking",
      baseUrl: "https://api.arcee.ai/api/v1",
    });
    if (!pick) throw new Error("managed status should produce a model pick");
    expect(matchesManagedModelPick(managedModelStatus, pick)).toBe(true);
    expect(matchesManagedModelPick(managedModelStatus, { ...pick, model: "other" })).toBe(true);
    expect(
      matchesManagedModelPick(managedModelStatus, { ...pick, baseUrl: "https://other.test" }),
    ).toBe(false);
    expect(
      matchesManagedModelPick(managedModelStatus, { ...pick, backend: "openai-responses" }),
    ).toBe(false);
    expect(matchesManagedModelPick(null, pick)).toBe(false);
    expect(managedModelPick(null)).toBeNull();
  });

  it("discovers the mounted-key and stored-login indexes without browser credentials", () => {
    // Only discovery/auth fields are read by this projection.
    const catalog = {
      catalog_version: 1,
      providers: [
        { id: "arcee-api", auth: "api_key_env", auth_status: "ready" },
        { id: "openai-responses", auth: "api_key_env", auth_status: "ready" },
        { id: "arcee-auth", auth: "managed_arcee", auth_status: "ready" },
        { id: "chatgpt-codex-responses", auth: "codex_oauth", auth_status: "no_credential" },
      ],
    } as ModelCatalog;
    expect(readyManagedModelRequests(catalog, managedModelStatus)).toEqual([
      { backend: "arcee-api", base_url: "https://api.arcee.ai/api/v1" },
      { backend: "arcee-auth" },
    ]);
    expect(readyManagedModelRequests(catalog, null)).toEqual([{ backend: "arcee-auth" }]);
    expect(
      readyManagedModelRequests(catalog, { ...managedModelStatus, model_ready: false }),
    ).toEqual([{ backend: "arcee-auth" }]);
  });
});
