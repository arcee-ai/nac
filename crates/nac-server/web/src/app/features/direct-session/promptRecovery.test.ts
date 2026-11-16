import { expect, it, vi } from "vitest";
import { createPromptDraftStore } from "../../store/promptDraftStore";
import { withPromptRecovery } from "./promptRecovery";

it("announces only an obtained in-memory recovery before dispatch", async () => {
  const drafts = createPromptDraftStore();
  const submitted = drafts.update("a", "small");
  const order: string[] = [];
  await withPromptRecovery(
    drafts,
    "a",
    submitted,
    async () => {
      order.push("dispatch");
    },
    () => {
      order.push("retained");
    },
  );
  expect(order).toEqual(["retained", "dispatch"]);
  const oversized = drafts.update("a", "x".repeat(1_000_001));
  const retained = vi.fn();
  const dispatch = vi.fn(async () => "accepted");
  expect(await withPromptRecovery(drafts, "a", oversized, dispatch, retained)).toBe("accepted");
  expect(retained).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledOnce();
  expect(drafts.get("a")).toBe(oversized);
});

it("keeps a newer identical revision after definite acceptance", async () => {
  const drafts = createPromptDraftStore();
  const submitted = drafts.update("a", "same");
  const response = Promise.withResolvers<string>();
  const dispatch = vi.fn(() => response.promise);
  const result = withPromptRecovery(drafts, "a", submitted, dispatch);
  expect(drafts.getRecoveries("a")[0].status).toBe("pending");
  drafts.update("a", "newer");
  drafts.update("a", "same");
  response.resolve("accepted");
  expect(await result).toBe("accepted");
  expect(drafts.acknowledge("a", submitted)).toBe(false);
  expect(drafts.get("a").text).toBe("same");
  expect(drafts.getRecoveries("a")).toEqual([]);
  expect(dispatch).toHaveBeenCalledOnce();
});

it("retains rejected/unknown text for review without retry, auto-restoration or a second send", async () => {
  const drafts = createPromptDraftStore();
  const submitted = drafts.update("a", "sent");
  const failure = new Error("response lost after admission");
  const dispatch = vi.fn().mockRejectedValue(failure);
  await expect(withPromptRecovery(drafts, "a", submitted, dispatch)).rejects.toBe(failure);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(drafts.get("a")).toBe(submitted);
  expect(drafts.getRecoveries("a")).toMatchObject([{ text: "sent", status: "uncertain" }]);
  expect(drafts.restoreRecovery("a", drafts.getRecoveries("a")[0])).toBe(false);
});

it("cannot settle a replaced runtime's checkpoint or a new session", async () => {
  const drafts = createPromptDraftStore();
  const submitted = drafts.update("a", "A");
  const response = Promise.withResolvers<void>();
  const operation = withPromptRecovery(drafts, "a", submitted, () => response.promise);
  drafts.release();
  const next = createPromptDraftStore();
  const recovery = next.retainSubmission("b", next.update("b", "B"));
  response.resolve();
  await operation;
  expect(next.getRecoveries("b")).toEqual([recovery]);
  expect(next.get("b").text).toBe("B");
});

it("does not gate the primary send on over-budget recovery and never truncates active text", async () => {
  const drafts = createPromptDraftStore();
  const submitted = drafts.update("a", "雪".repeat(1_000_001));
  const dispatch = vi.fn().mockResolvedValue("accepted");
  expect(await withPromptRecovery(drafts, "a", submitted, dispatch)).toBe("accepted");
  expect(dispatch).toHaveBeenCalledOnce();
  expect(drafts.get("a")).toBe(submitted);
  expect(drafts.acknowledge("a", submitted)).toBe(true);
});
