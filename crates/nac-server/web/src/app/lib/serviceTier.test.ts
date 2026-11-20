import { expect, it } from "vitest";
import { discoveredSpeed } from "./serviceTier";
import type { CatalogModel } from "@/app/types/api";

it("never infers a snapshot model's entitlement from a family match", () => {
  const model = {
    id: "model",
    service_tiers: [{ id: "priority", name: "Fast", description: "Priority" }],
  } as CatalogModel;
  expect(discoveredSpeed(model, "model-20261118")).toBeNull();
  expect(discoveredSpeed(model, "model")).toHaveLength(1);
});
