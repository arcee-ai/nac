import { expect, it } from "vitest";
import { discoveredSpeed, speedForRoute } from "./serviceTier";
import type { CatalogModel } from "@/app/types/api";

it("never infers a snapshot model's entitlement from a family match", () => {
  const model = {
    id: "model",
    service_tiers: [{ id: "priority", name: "Fast", description: "Priority" }],
  } as CatalogModel;
  expect(discoveredSpeed(model, "model-20261118")).toBeNull();
  expect(discoveredSpeed(model, "model")).toHaveLength(1);
});

it("offers native acceleration only for an exact model and canonical route", () => {
  const profiles = { "gpt-5.5": { tiers: ["standard", "fast"], fast_input_tokens_below: 272000 } };
  for (const backend of ["openai-responses", "openai-chat-completions"]) {
    const supported = speedForRoute(
      null,
      "gpt-5.5",
      backend,
      "https://api.openai.com/v1/",
      profiles,
    );
    expect(supported.tiers).toHaveLength(1);
    expect(supported.fastContextLimit).toBe(272000);
    expect(
      speedForRoute(null, "gpt-5.5-20261118", backend, "https://api.openai.com/v1", profiles).tiers,
    ).toBeNull();
    for (const url of [
      "https://api.openai.com.evil/v1",
      "http://api.openai.com/v1",
      "https://api.openai.com/v1?x=1",
      "http://localhost/v1",
    ]) {
      expect(speedForRoute(null, "gpt-5.5", backend, url, profiles).tiers).toBeNull();
    }
  }
  expect(
    speedForRoute(null, "gpt-5.5", "together-chat", "https://api.openai.com/v1", profiles).tiers,
  ).toBeNull();
});
