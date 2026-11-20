/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UnconfirmedPromptNotice, UnconfirmedPromptRecovery } from "./UnconfirmedPromptNotice";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";

afterEach(() => vi.useRealTimers());
it("offers an accessible explicit display-only dismissal after a bounded delay", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const view = render(<UnconfirmedPromptNotice visible onDismiss={dismiss} />);
  expect(screen.queryByRole("status")).toBeNull();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("status").textContent).toContain("may have been sent");
  fireEvent.click(screen.getByRole("button", { name: "Hide unconfirmed message" }));
  expect(dismiss).toHaveBeenCalledOnce();
  view.rerender(<UnconfirmedPromptNotice visible={false} onDismiss={dismiss} />);
  expect(screen.queryByRole("status")).toBeNull();
});
it("cancels the notice when the prompt settles before the delay", () => {
  vi.useFakeTimers();
  const view = render(<UnconfirmedPromptNotice visible onDismiss={() => {}} />);
  view.rerender(<UnconfirmedPromptNotice visible={false} onDismiss={() => {}} />);
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("status")).toBeNull();
});

it("binds recovery visibility and dismissal to the exact session and submission", () => {
  vi.useFakeTimers();
  const owner = standaloneRuntime.stores.runtimeStore;
  act(() => owner.resetRuntime("s"));
  let first = 0;
  act(() => {
    first = owner.setOptimisticUserPrompt("first")!;
    owner.bindOptimisticPrompt(first, "run-a");
  });
  const view = render(
    <UnconfirmedPromptRecovery sessionId="s" showPending running={false} token={first} />,
  );
  act(() => vi.advanceTimersByTime(1000));
  let second = 0;
  act(() => {
    second = owner.setOptimisticUserPrompt("second")!;
    owner.bindOptimisticPrompt(second, "run-b");
  });
  view.rerender(
    <UnconfirmedPromptRecovery sessionId="s" showPending running={false} token={second} />,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toBeTruthy();
  act(() => owner.dismissOptimisticPrompt(first));
  expect(owner.getRuntimeState().optimisticUserPrompt).toBe("second");
  fireEvent.click(screen.getByRole("button", { name: "Hide unconfirmed message" }));
  expect(owner.getRuntimeState().optimisticUserPrompt).toBeNull();
  act(() => {
    owner.resetRuntime("other");
    const token = owner.setOptimisticUserPrompt("third")!;
    owner.bindOptimisticPrompt(token, "run-c");
  });
  view.rerender(
    <UnconfirmedPromptRecovery sessionId="s" showPending running={false} token={second} />,
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("status")).toBeNull();
  owner.resetRuntime(null);
});

it("keeps recovery available on a disconnected stale running flag and preserves the retained draft", () => {
  vi.useFakeTimers();
  const owner = standaloneRuntime.stores.runtimeStore;
  const drafts = standaloneRuntime.stores.promptDraftStore;
  act(() => owner.resetRuntime("s"));
  const draft = drafts.update("s", "please keep");
  const checkpoint = drafts.retainSubmission("s", draft)!;
  drafts.settleSubmission("s", checkpoint, "uncertain");
  let token = 0;
  act(() => {
    token = owner.setOptimisticUserPrompt("please keep")!;
    owner.markOptimisticPromptUncertain(token);
    owner.runtimeStore.setState({ running: true, streamStatus: "error" });
  });
  render(<UnconfirmedPromptRecovery sessionId="s" showPending running token={token} />);
  act(() => vi.advanceTimersByTime(2000));
  fireEvent.click(screen.getByRole("button", { name: "Hide unconfirmed message" }));
  expect(owner.getRuntimeState().optimisticUserPrompt).toBeNull();
  expect(drafts.getRecoveries("s")).toMatchObject([{ text: "please keep", status: "uncertain" }]);
  owner.resetRuntime(null);
});

it("does not allow a stale click to hide a live current run", () => {
  const owner = standaloneRuntime.stores.runtimeStore;
  owner.resetRuntime("s");
  const token = owner.setOptimisticUserPrompt("live")!;
  owner.bindOptimisticPrompt(token, "run");
  owner.runtimeStore.setState({ running: true, streamStatus: "live" });
  owner.dismissOptimisticPrompt(token);
  expect(owner.getRuntimeState().optimisticUserPrompt).toBe("live");
  owner.resetRuntime(null);
});

it("does not expose recovery for a live run or a prompt proven before the delay", () => {
  vi.useFakeTimers();
  const owner = standaloneRuntime.stores.runtimeStore;
  owner.resetRuntime("s");
  const token = owner.setOptimisticUserPrompt("prompt")!;
  owner.bindOptimisticPrompt(token, "run");
  owner.runtimeStore.setState({ running: true, streamStatus: "live" });
  const view = render(
    <UnconfirmedPromptRecovery sessionId="s" showPending running token={token} />,
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => owner.runtimeStore.setState({ running: false }));
  view.rerender(
    <UnconfirmedPromptRecovery sessionId="s" showPending running={false} token={token} />,
  );
  act(() => vi.advanceTimersByTime(1000));
  view.rerender(
    <UnconfirmedPromptRecovery sessionId="s" showPending={false} running={false} token={token} />,
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("status")).toBeNull();
  owner.resetRuntime(null);
});

it("does not silently forget a hidden run when the session dismissal limit is reached", () => {
  vi.useFakeTimers();
  const owner = standaloneRuntime.stores.runtimeStore;
  owner.resetRuntime("s");
  const token = owner.setOptimisticUserPrompt("pending")!;
  owner.bindOptimisticPrompt(token, "new-run");
  owner.runtimeStore.setState({
    dismissedPromptRunIds: Array.from({ length: 128 }, (_, index) => `run-${index}`),
  });
  render(<UnconfirmedPromptRecovery sessionId="s" showPending running={false} token={token} />);
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("status").textContent).toContain("Reopen this session");
  expect(screen.queryByRole("button", { name: "Hide unconfirmed message" })).toBeNull();
  owner.dismissOptimisticPrompt(token);
  expect(owner.getRuntimeState().optimisticUserPrompt).toBe("pending");
  expect(owner.getRuntimeState().dismissedPromptRunIds).toHaveLength(128);
  owner.resetRuntime(null);
});
