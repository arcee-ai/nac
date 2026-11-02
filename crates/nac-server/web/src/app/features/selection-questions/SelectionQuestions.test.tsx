/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import type { SelectionQuestion, SessionSnapshotResponse } from "@/app/types/api";

import { SelectionQuestionPane } from "./SelectionQuestionPane";
import { SelectionQuestions } from "./SelectionQuestions";
import { sha256Hex } from "./selectionBinding";

const REPLY = "The cache is keyed by **session id**.\n\nEntries expire after an hour.";

const opened: NativeRuntime[] = [];
function runtime(fetch: typeof globalThis.fetch) {
  const endpoint = "https://one.example/nac";
  const value = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "one",
      incarnation: "one",
      endpoint,
      release: "test",
    },
    client: createNacClient({ endpoint, credentials: "omit", fetch }),
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  opened.push(value);
  return value;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  for (const value of opened.splice(0)) value.close();
});

const limits = {
  max_excerpt_chars: 4000,
  max_question_chars: 2000,
  max_source_context_chars: 12000,
  max_prompt_context_chars: 4000,
  max_answer_chars: 16000,
  history_limit: 50,
  provider_timeout_secs: 120,
};

function question(overrides: Partial<SelectionQuestion> = {}): SelectionQuestion {
  return {
    question_id: "q-1",
    request_key: "00000000-0000-4000-8000-000000000001",
    status: "answered",
    source: {
      message_index: 2,
      content_sha256: sha256Hex(REPLY),
      selection_start: 22,
      selection_end: 36,
      source_text_truncated: false,
      has_preceding_prompt: true,
    },
    excerpt: "**session id**",
    question: "Why per session?",
    model: { model: "gpt-5.5", backend: "openai-responses", config_version: 0 },
    answer: "Because each chat owns its cache.",
    answer_truncated: false,
    error: null,
    tool_call_attempted: false,
    usage: {
      input_tokens: 21,
      output_tokens: 6,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 27,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 },
    } as SelectionQuestion["usage"],
    created_at: "2026-10-30 00:00:00",
    updated_at: "2026-10-30 00:00:01",
    completed_at: "2026-10-30 00:00:01",
    ...overrides,
  };
}

const messages = [
  { role: "system", content: "policy" },
  { role: "user", content: "How does the cache work?" },
  { role: "assistant", content: REPLY, reasoning_text: "hidden" },
] as unknown as SessionSnapshotResponse["messages"];

function Harness({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>
        <div data-selection-source="2">
          <p>
            The cache is keyed by <strong>session id</strong>.
          </p>
          <p>Entries expire after an hour.</p>
        </div>
        <p data-testid="outside">Tool output that is not a reply.</p>
      </div>
      <SelectionQuestions sessionId="chat" messages={messages} windowStart={0} containerRef={ref} />
      {children}
    </div>
  );
}

function select(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("SelectionQuestions", () => {
  it("keeps the Ask control on the selection as the transcript scrolls, and hides it off screen", async () => {
    let rect = { top: 100, bottom: 120, left: 40 };
    const geometry = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ ...rect, right: rect.left + 100, width: 100, height: 20 }) as DOMRect,
    });
    try {
      const value = runtime(
        vi.fn(async () =>
          Response.json({ items: [], limits }),
        ) as unknown as typeof globalThis.fetch,
      );
      render(
        <QueryClientProvider client={value.queryClient}>
          <RuntimeContext.Provider value={value}>
            <Harness />
          </RuntimeContext.Provider>
        </QueryClientProvider>,
      );
      select(screen.getByText("Entries expire after an hour.").firstChild!, 0, 7);
      const control = async () =>
        (await screen.findByRole("button", { name: "Ask about selection" })).parentElement!;
      expect((await control()).style.top).toBe("126px");

      const scroll = async () => {
        await act(async () => {
          screen.getByTestId("outside").parentElement!.dispatchEvent(new Event("scroll"));
          await new Promise((resolve) => requestAnimationFrame(resolve));
        });
      };
      rect = { top: 300, bottom: 320, left: 40 };
      await scroll();
      expect((await control()).style.top).toBe("326px");

      rect = { top: -80, bottom: -60, left: 40 };
      await scroll();
      expect(screen.queryByRole("button", { name: "Ask about selection" })).toBeNull();
    } finally {
      if (geometry) Object.defineProperty(Range.prototype, "getBoundingClientRect", geometry);
      else delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it("asks about a selection inside one completed reply and shows the attributed answer", async () => {
    let listed: SelectionQuestion[] = [];
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/sessions/chat/selection-questions")) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        listed = [question({ request_key: String(body.request_key) })];
        return Response.json({ replayed: false, question: listed[0] });
      }
      if (url.endsWith("/sessions/chat/selection-questions")) {
        return Response.json({ items: listed, limits });
      }
      return Response.json({ error: `unexpected ${url}` }, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const value = runtime(fetch);
    render(
      <QueryClientProvider client={value.queryClient}>
        <RuntimeContext.Provider value={value}>
          <Harness />
        </RuntimeContext.Provider>
      </QueryClientProvider>,
    );
    // Selecting outside a completed reply offers nothing.
    select(screen.getByTestId("outside").firstChild!, 0, 4);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(screen.queryByRole("button", { name: "Ask about selection" })).toBeNull();

    select(screen.getByText("session id").firstChild!, 0, 10);
    fireEvent.click(await screen.findByRole("button", { name: "Ask about selection" }));
    const review = await screen.findByRole("form", {
      name: "Review selection question",
    });
    expect(screen.getByLabelText("Selected excerpt").textContent).toBe("session id");
    expect(review.textContent).toContain("Selected from reply #2");
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "Why per session?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      source_message_index: 2,
      source_content_sha256: sha256Hex(REPLY),
      selection_start: 24,
      selection_end: 34,
      excerpt: "session id",
      question: "Why per session?",
    });
    expect(String(bodies[0].request_key)).toMatch(/^[0-9a-f-]{36}$/);
    const answer = await screen.findByRole("article", {
      name: "Question about selection: Why per session?",
    });
    expect(answer.textContent).toContain("Because each chat owns its cache.");
    expect(answer.textContent).toContain("About reply #2 · gpt-5.5");
    expect(answer.textContent).toContain("counted separately from this chat");
  });

  it("retries an unconfirmed question with the same request key", async () => {
    const keys: string[] = [];
    let attempt = 0;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        keys.push(String(body.request_key));
        attempt += 1;
        if (attempt === 1) throw new TypeError("network connection lost");
        return Response.json({
          replayed: true,
          question: question({
            status: "pending",
            answer: null,
            completed_at: null,
          }),
        });
      }
      return Response.json({ items: [], limits });
    }) as unknown as typeof globalThis.fetch;
    const value = runtime(fetch);
    render(
      <QueryClientProvider client={value.queryClient}>
        <RuntimeContext.Provider value={value}>
          <Harness />
        </RuntimeContext.Provider>
      </QueryClientProvider>,
    );
    select(screen.getByText("Entries expire after an hour.").firstChild!, 0, 7);
    fireEvent.click(await screen.findByRole("button", { name: "Ask about selection" }));
    fireEvent.change(await screen.findByLabelText("Your question"), {
      target: { value: "How long?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findByRole("alert")).textContent).toContain("may not have reached");
    fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("SelectionQuestionPane", () => {
  it("shows pending, tool-call and interrupted outcomes honestly", () => {
    const onCancel = vi.fn();
    render(
      <SelectionQuestionPane
        review={null}
        questions={[
          question({
            question_id: "a",
            question: "first",
            status: "interrupted",
            answer: null,
            usage: null,
            error: "The server stopped before this question was answered. It was not sent again.",
          }),
          question({
            question_id: "b",
            question: "second",
            status: "failed",
            answer: null,
            tool_call_attempted: true,
            error:
              "The model attempted a tool call instead of answering. No tool was run and no answer was recorded.",
          }),
          question({
            question_id: "c",
            question: "third",
            status: "pending",
            answer: null,
            usage: null,
            completed_at: null,
          }),
        ]}
        cancelingId={null}
        onQuestionChange={vi.fn()}
        onAsk={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={onCancel}
        onClose={vi.fn()}
      />,
    );
    const cards = screen.getAllByRole("article");
    // Newest first.
    expect(cards[0].textContent).toContain("third");
    expect(cards[0].textContent).toContain("Answering…");
    fireEvent.click(screen.getByRole("button", { name: "Cancel question" }));
    expect(onCancel).toHaveBeenCalledWith("c");
    expect(cards[1].textContent).toContain("the model tried to use a tool; nothing was run");
    expect(cards[2].textContent).toContain("Interrupted");
    expect(cards[2].textContent).toContain("It was not sent again.");
    expect(screen.getAllByRole("button", { name: "Cancel question" })).toHaveLength(1);
  });

  it("blocks a selection that cannot be bound", () => {
    render(
      <SelectionQuestionPane
        review={{
          messageIndex: 4,
          excerpt: "x",
          question: "Why?",
          error: "This selection could not be matched to the reply’s text.",
          uncertain: false,
          blocked: true,
          sending: false,
        }}
        questions={[]}
        cancelingId={null}
        onQuestionChange={vi.fn()}
        onAsk={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("could not be matched");
    expect(screen.getByRole("button", { name: "Ask" })).toHaveProperty("disabled", true);
  });
});
