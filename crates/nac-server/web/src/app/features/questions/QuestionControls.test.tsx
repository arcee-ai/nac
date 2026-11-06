/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/app/services/api";
import type { QuestionRecord } from "@/app/types/api";
import { QuestionControls } from "./QuestionControls";

const question: QuestionRecord = {
  request: {
    session_id: "target",
    request_id: "exact",
    run_id: "run",
    generation: "run",
    text: "Which format?",
    choices: ["CSV", "JSON"],
    responder_class: "human_decision",
  },
  revision: 1,
  status: "pending",
  goal_id: null,
  answer: null,
  continuation_state: null,
  created_at: "fixture",
};
const list = vi.spyOn(api, "taskQuestions");
const answer = vi.spyOn(api, "answerTaskQuestion");
const cancel = vi.spyOn(api, "cancelTaskQuestion");

function mount(selected = "exact", session = "target") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 5 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/session/${session}?question_request=${selected}`]}>
        <QuestionControls sessionId={session} enabled />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  list.mockReset().mockResolvedValue([question]);
  answer.mockReset();
  cancel.mockReset();
});
afterEach(() => {
  cleanup();
});

it("answers only the exact displayed request and its immutable binding", async () => {
  answer.mockResolvedValue({
    session_id: "target",
    request_id: "exact",
    run_id: "run",
    generation: "run",
    revision: 2,
    answer: "CSV",
    continuation_run_id: "reserved",
    inbox_item_id: 1,
  });
  mount();
  await screen.findByRole("region", { name: "Task question" });
  fireEvent.click(screen.getByRole("button", { name: "CSV" }));
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
  expect(answer).toHaveBeenCalledWith("target", {
    request_id: "exact",
    run_id: "run",
    generation: "run",
    expected_revision: 1,
    answer: "CSV",
  });
  expect(cancel).not.toHaveBeenCalled();
});

it("stale exact navigation never offers another pending question as the response target", async () => {
  list.mockResolvedValue([
    { ...question, request: { ...question.request, request_id: "replacement" } },
  ]);
  mount();
  await screen.findByText(/This task question is no longer pending/);
  expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
  expect(answer).not.toHaveBeenCalled();
});

it("failed or uncertain answer admission never automatically retries", async () => {
  answer.mockRejectedValue(new Error("Delivery unconfirmed; retry the same exact answer"));
  mount();
  const textbox = await screen.findByRole("textbox", { name: "Your answer" });
  fireEvent.change(textbox, { target: { value: "CSV" } });
  fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByRole("alert");
  expect(answer).toHaveBeenCalledTimes(1);
  expect((textbox as HTMLTextAreaElement).value).toBe("CSV");
});

it("cancellation binds the exact request revision without sending an answer", async () => {
  cancel.mockResolvedValue({ ...question, status: "cancelled", revision: 2 });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel question" }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith("target", "exact", 1));
  expect(answer).not.toHaveBeenCalled();
});
