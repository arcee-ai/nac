/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import { SessionActionsProvider, useSessionActions } from "@/app/providers/SessionActionsProvider";
import { ApiError } from "@/app/services/api";
import type { SessionSummarySnapshot } from "@/app/types/api";

const fakes = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  pending: false,
  sessions: [] as Array<unknown>,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/hooks/useMediaQuery")>()),
  useIsMobile: () => false,
}));
vi.mock("@/app/runtime/RuntimeContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/runtime/RuntimeContext")>()),
  useNativeRuntime: () => ({
    stores: {
      runtimeStore: { pushLocalEvent: vi.fn(), captureRuntimeActivation: () => () => true },
    },
  }),
}));
vi.mock("@/app/providers/ToastProvider", () => ({
  errorMessage: (error: unknown) => String(error),
  useToast: () => fakes.toast,
}));
vi.mock("@/app/services/queries", () => ({
  useSessions: () => ({ data: fakes.sessions }),
  useTogglePin: () => ({ toggle: vi.fn() }),
  useCancelRun: () => ({ mutateAsync: vi.fn() }),
  // `isPending` does not follow the calls here, so only the dialogs' own guard
  // can keep a second submission from going out.
  useUpdatePresentation: () => ({ mutateAsync: fakes.update, isPending: fakes.pending }),
  useDeleteSession: () => ({ mutateAsync: fakes.remove, isPending: fakes.pending }),
}));
vi.mock("@/app/components/modals/SettingsModal", () => ({ SettingsModal: () => null }));

const summary = {
  session_id: "chat-1",
  title: "Draft plan",
  project_id: "project-1",
  pinned: false,
  presentation_version: 3,
} as SessionSummarySnapshot;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** How the server refuses to delete a delegated session. */
const deleteRefusal = () =>
  new ApiError(
    409,
    "DELETE",
    "/sessions/chat-1",
    "delegated sessions accept work only through their parent",
    "test-request",
  );

function Row({ entry = summary }: { entry?: SessionSummarySnapshot }) {
  const actions = useSessionActions();
  const location = useLocation();
  return (
    <>
      <ChatSessionActions
        title={entry.title ?? "Draft plan"}
        onRename={() => actions.rename(entry)}
        onDelete={() => actions.remove(entry)}
      />
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

function fixture(path = "/session/chat-2", entry = summary) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <PresentationBoundary>
        <SessionActionsProvider>
          <Row entry={entry} />
        </SessionActionsProvider>
      </PresentationBoundary>
    </MemoryRouter>
  );
}

function mount(path = "/session/chat-2", entry = summary) {
  return render(fixture(path, entry));
}

function acceptPresentation({
  title,
  pinned,
  expectedVersion,
}: {
  title: string;
  pinned: boolean;
  expectedVersion: number;
}) {
  return Promise.resolve({
    ...summary,
    title: title || null,
    pinned,
    presentation_version: expectedVersion + 1,
  });
}

function openFrom(name: string) {
  const opener = screen.getByRole("button", { name });
  act(() => opener.focus());
  fireEvent.click(opener);
  return opener;
}

const location = () => screen.getByTestId("location").textContent;
const inert = (view: ReturnType<typeof mount>) =>
  view.container.querySelector("[data-nac-content]")?.hasAttribute("inert");

beforeEach(() => {
  fakes.pending = false;
  fakes.sessions = [{ summary }];
  fakes.update.mockReset();
  fakes.update.mockImplementation(acceptPresentation);
  fakes.remove.mockReset();
  fakes.toast.success.mockReset();
  fakes.toast.error.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("session actions", () => {
  it("name their row controls once, with a hint instead of a native title", () => {
    mount();
    const rename = screen.getByRole("button", { name: "Rename Draft plan" });
    expect(rename.hasAttribute("title")).toBe(false);

    fireEvent.mouseEnter(rename);
    expect(screen.getByRole("tooltip").textContent).toBe("Rename chat");
    expect(screen.getAllByText("Rename chat")).toHaveLength(1);
  });

  it("rename once through the form, stay on the route and hand focus back", async () => {
    const save = deferred<SessionSummarySnapshot>();
    fakes.update.mockReturnValue(save.promise);
    const view = mount();
    const opener = openFrom("Rename Draft plan");

    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    expect(document.activeElement).toBe(dialog);
    expect(inert(view)).toBe(true);

    const field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "  Final plan " } });
    // Enter that only commits an IME composition is not a submission.
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(fakes.update).not.toHaveBeenCalled();

    const form = field.form!;
    expect(within(dialog).getByRole("button", { name: "Save" }).getAttribute("form")).toBe(form.id);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fakes.update).toHaveBeenCalledExactlyOnceWith({
      id: "chat-1",
      title: "Final plan",
      pinned: false,
      expectedVersion: 3,
    });

    await act(async () =>
      save.resolve({ ...summary, title: "Final plan", presentation_version: 4 }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fakes.toast.success).toHaveBeenCalledWith("Session presentation saved");
    expect(location()).toBe("/session/chat-2");
    expect(inert(view)).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("keep a rename open after a version conflict, and let the retry through", async () => {
    fakes.update
      .mockRejectedValueOnce(
        new ApiError(409, "PATCH", "/sessions/chat-1", "version conflict", "test-request"),
      )
      .mockImplementationOnce(acceptPresentation);
    mount();
    openFrom("Rename Draft plan");
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    const form = within(dialog).getByLabelText<HTMLInputElement>("Title").form!;

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(fakes.toast.error).toHaveBeenCalledWith(
      "Version conflict — the session changed in the meantime",
    );
    expect(screen.getByRole("dialog")).toBe(dialog);

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(fakes.update).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keep a rename the server rejects open, with the typed title, for a retry", async () => {
    fakes.update
      .mockRejectedValueOnce(
        new ApiError(
          400,
          "PATCH",
          "/sessions/chat-1",
          "session title must not exceed 120 characters",
          "test-request",
        ),
      )
      .mockImplementationOnce(acceptPresentation);
    mount();
    openFrom("Rename Draft plan");
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    const field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    const tooLong = "x".repeat(121);
    fireEvent.change(field, { target: { value: tooLong } });

    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(fakes.toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Error: .*session title must not exceed 120 characters/),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(field.value).toBe(tooLong);

    fireEvent.change(field, { target: { value: "Final plan" } });
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(fakes.update).toHaveBeenCalledTimes(2);
    expect(fakes.update).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Final plan" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hold the field and the dialog's controls while a save is in flight", () => {
    fakes.update.mockReturnValue(deferred<SessionSummarySnapshot>().promise);
    mount();
    openFrom("Rename Draft plan");
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    fireEvent.submit(within(dialog).getByLabelText<HTMLInputElement>("Title").form!);

    const field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.readOnly).toBe(true);
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox").disabled).toBe(true);
    expect(field.getAttribute("aria-busy")).toBe("true");
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(
      true,
    );
    const save = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Save" });
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-busy")).toBe("true");
  });

  it("cancel a rename or a delete without writing anything", async () => {
    mount();
    const cases = [
      ["Rename Draft plan", "dialog", "Rename session"],
      ["Delete Draft plan", "alertdialog", "Delete session"],
    ] as const;
    for (const [action, role, title] of cases) {
      const opener = openFrom(action);
      const dialog = screen.getByRole(role, { name: title });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole(role)).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(opener));
    }
    expect(fakes.update).not.toHaveBeenCalled();
    expect(fakes.remove).not.toHaveBeenCalled();
    expect(location()).toBe("/session/chat-2");
  });

  it("reopen a cancelled rename from the current title", async () => {
    fakes.update.mockImplementation(acceptPresentation);
    mount();
    const opener = openFrom("Rename Draft plan");
    const cancelled = screen.getByRole("dialog", { name: "Rename session" });
    fireEvent.change(within(cancelled).getByLabelText("Title"), { target: { value: "Abandoned" } });
    fireEvent.click(within(cancelled).getByRole("checkbox"));
    fireEvent.click(within(cancelled).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    // Reopen before the exit transition unmounts the retained form.
    openFrom("Rename Draft plan");
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    expect(document.activeElement).toBe(dialog);
    const field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("Draft plan");
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(fakes.update).toHaveBeenCalledExactlyOnceWith({
      id: "chat-1",
      title: "Draft plan",
      pinned: false,
      expectedVersion: 3,
    });
  });

  it("preserves a pending rename and its single-write guard across a quick reopen", async () => {
    const save = deferred<SessionSummarySnapshot>();
    fakes.update.mockReturnValue(save.promise);
    mount();
    openFrom("Rename Draft plan");
    let dialog = screen.getByRole("dialog", { name: "Rename session" });
    let field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "Pending title" } });
    fireEvent.submit(field.form!);
    fireEvent.keyDown(dialog, { key: "Escape" });
    openFrom("Rename Draft plan");
    dialog = screen.getByRole("dialog", { name: "Rename session" });
    field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("Pending title");
    fireEvent.submit(field.form!);
    expect(fakes.update).toHaveBeenCalledTimes(1);
    await act(async () =>
      save.resolve({ ...summary, title: "Pending title", presentation_version: 4 }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retains a pending rename draft and single write after the form exits", async () => {
    vi.useFakeTimers();
    const save = deferred<SessionSummarySnapshot>();
    fakes.update.mockReturnValue(save.promise);
    mount();
    openFrom("Rename Draft plan");
    let dialog = screen.getByRole("dialog", { name: "Rename session" });
    let field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "  Pending title  " } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.submit(field.form!);
    fireEvent.keyDown(dialog, { key: "Escape" });
    act(() => vi.advanceTimersByTime(301));
    openFrom("Rename Draft plan");
    dialog = screen.getByRole("dialog", { name: "Rename session" });
    field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("  Pending title  ");
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox").checked).toBe(true);
    fireEvent.submit(field.form!);
    expect(fakes.update).toHaveBeenCalledExactlyOnceWith({
      id: "chat-1",
      title: "Pending title",
      pinned: true,
      expectedVersion: 3,
    });
    await act(async () =>
      save.resolve({ ...summary, title: "Pending title", pinned: true, presentation_version: 4 }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => vi.advanceTimersByTime(301));
    openFrom("Rename Draft plan");
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Pending title");
  });

  it("retains the reopened pending draft after failure and permits one retry", async () => {
    vi.useFakeTimers();
    const save = deferred<SessionSummarySnapshot>();
    fakes.update.mockReturnValueOnce(save.promise).mockImplementationOnce(acceptPresentation);
    mount();
    openFrom("Rename Draft plan");
    let field = screen.getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "Pending title" } });
    fireEvent.submit(field.form!);
    fireEvent.keyDown(field, { key: "Escape" });
    act(() => vi.advanceTimersByTime(301));
    openFrom("Rename Draft plan");
    await act(async () => save.reject(new Error("Network unavailable")));
    field = screen.getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("Pending title");
    expect(field.readOnly).toBe(false);
    fireEvent.change(field, { target: { value: "Retry title" } });
    await act(async () => {
      fireEvent.submit(field.form!);
      fireEvent.submit(field.form!);
    });
    expect(fakes.update).toHaveBeenCalledTimes(2);
    expect(fakes.update).toHaveBeenLastCalledWith({
      id: "chat-1",
      title: "Retry title",
      pinned: false,
      expectedVersion: 3,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["success", "failure"])(
    "settles an older session's %s without changing the newer pending form",
    async (outcome) => {
      vi.useFakeTimers();
      const first = deferred<SessionSummarySnapshot>();
      const second = deferred<SessionSummarySnapshot>();
      fakes.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const view = mount();
      openFrom("Rename Draft plan");
      let field = screen.getByLabelText<HTMLInputElement>("Title");
      fireEvent.change(field, { target: { value: "Accepted A" } });
      fireEvent.submit(field.form!);
      fireEvent.keyDown(field, { key: "Escape" });
      act(() => vi.advanceTimersByTime(301));
      const other = {
        ...summary,
        session_id: "chat-b",
        title: "Other chat",
        presentation_version: 8,
      };
      view.rerender(fixture("/session/chat-2", other));
      openFrom("Rename Other chat");
      field = screen.getByLabelText<HTMLInputElement>("Title");
      fireEvent.change(field, { target: { value: "Pending B" } });
      fireEvent.submit(field.form!);
      await act(async () => {
        if (outcome === "success")
          first.resolve({ ...summary, title: "Accepted A", presentation_version: 4 });
        else first.reject(new Error("A failed"));
      });
      expect(screen.getByRole("dialog", { name: "Rename session" })).toBeTruthy();
      expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Pending B");
      fireEvent.submit(field.form!);
      expect(fakes.update).toHaveBeenCalledTimes(2);
      await act(async () =>
        second.resolve({ ...other, title: "Accepted B", presentation_version: 9 }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      view.rerender(fixture("/session/chat-2", summary));
      openFrom("Rename Draft plan");
      expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe(
        outcome === "success" ? "Accepted A" : "Draft plan",
      );
    },
  );

  it("does not let an old rename success dismiss a newer delete for that session", async () => {
    const save = deferred<SessionSummarySnapshot>();
    fakes.update.mockReturnValue(save.promise);
    mount();
    openFrom("Rename Draft plan");
    const field = screen.getByLabelText<HTMLInputElement>("Title");
    fireEvent.submit(field.form!);
    fireEvent.keyDown(field, { key: "Escape" });
    openFrom("Delete Draft plan");
    await act(async () => save.resolve({ ...summary, title: "Accepted", presentation_version: 4 }));
    expect(screen.getByRole("alertdialog", { name: "Delete session" })).toBeTruthy();
    expect(fakes.remove).not.toHaveBeenCalled();
  });

  it("reopens from the accepted title, pin and version before the row summary refreshes", async () => {
    mount();
    openFrom("Rename Draft plan");
    let dialog = screen.getByRole("dialog");
    let field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "Accepted title" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // The row still carries revision 3, but the server accepted revision 4.
    openFrom("Rename Draft plan");
    dialog = screen.getByRole("dialog");
    field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("Accepted title");
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox").checked).toBe(true);
    fireEvent.change(field, { target: { value: "Second accepted title" } });
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(fakes.update).toHaveBeenLastCalledWith({
      id: "chat-1",
      title: "Second accepted title",
      pinned: true,
      expectedVersion: 4,
    });
    expect(fakes.update).toHaveBeenCalledTimes(2);
  });

  it("retains accepted authority after exit unmount and prefers a newer external summary", async () => {
    vi.useFakeTimers();
    const view = mount();
    openFrom("Rename Draft plan");
    let dialog = screen.getByRole("dialog");
    let field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "Accepted title" } });
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    act(() => vi.advanceTimersByTime(300));
    openFrom("Rename Draft plan");
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Title").value).toBe("Accepted title");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const fresh = { ...summary, title: "External title", pinned: true, presentation_version: 9 };
    view.rerender(fixture("/session/chat-2", fresh));
    openFrom("Rename External title");
    dialog = screen.getByRole("dialog");
    field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("External title");
    expect(within(dialog).getByRole<HTMLInputElement>("checkbox").checked).toBe(true);
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(fakes.update).toHaveBeenLastCalledWith({
      id: "chat-1",
      title: "External title",
      pinned: true,
      expectedVersion: 9,
    });

    // A late stale row cannot downgrade the accepted presentation again.
    view.rerender(fixture("/session/chat-2", summary));
    openFrom("Rename Draft plan");
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("External title");
  });

  it("keeps accepted presentation baselines separate when switching session targets", async () => {
    const view = mount();
    openFrom("Rename Draft plan");
    let field = screen.getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "Accepted A" } });
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    const other = {
      ...summary,
      session_id: "chat-b",
      title: "Other chat",
      presentation_version: 2,
    };
    view.rerender(fixture("/session/chat-2", other));
    openFrom("Rename Other chat");
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("Other chat");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    view.rerender(fixture("/session/chat-2", summary));
    openFrom("Rename Draft plan");
    field = screen.getByLabelText<HTMLInputElement>("Title");
    expect(field.value).toBe("Accepted A");
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(fakes.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "chat-1", expectedVersion: 4 }),
    );
  });

  it("retains only presentation authority while accepting fresh automatic-title metadata", async () => {
    const view = mount();
    openFrom("Rename Draft plan");
    const field = screen.getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(field, { target: { value: "" } });
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    view.rerender(
      fixture("/session/chat-2", {
        ...summary,
        title: null,
        last_user_prompt: "Fresh external prompt",
        presentation_version: 4,
      }),
    );
    openFrom("Rename Draft plan");
    expect(screen.getByLabelText<HTMLInputElement>("Title").placeholder).toBe(
      "Fresh external prompt",
    );
  });

  it("reopen a cancelled delete and confirm it once", async () => {
    fakes.remove.mockResolvedValue(undefined);
    mount();
    const opener = openFrom("Delete Draft plan");
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));

    openFrom("Delete Draft plan");
    const dialog = screen.getByRole("alertdialog", { name: "Delete session" });
    expect(document.activeElement).toBe(dialog);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete session" }));
    });
    expect(fakes.remove).toHaveBeenCalledExactlyOnceWith("chat-1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirm a delete exactly once, from an alert that says what goes", async () => {
    const done = deferred();
    fakes.remove.mockReturnValue(done.promise);
    mount();
    openFrom("Delete Draft plan");

    const dialog = screen.getByRole("alertdialog", { name: "Delete session" });
    const description = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain("This action cannot be undone.");

    const confirm = within(dialog).getByRole("button", { name: "Delete session" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fakes.remove).toHaveBeenCalledExactlyOnceWith("chat-1");

    await act(async () => done.resolve());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fakes.toast.success).toHaveBeenCalledWith("Session deleted");
    expect(location()).toBe("/session/chat-2");
  });

  it("leave a deleted open chat before the delete lands, closing the dialog with the route", async () => {
    const done = deferred();
    fakes.remove.mockReturnValue(done.promise);
    mount("/session/chat-1");
    openFrom("Delete Draft plan");

    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete session" }),
    );
    expect(location()).toBe("/project/project-1");
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => done.resolve());
    expect(fakes.remove).toHaveBeenCalledExactlyOnceWith("chat-1");
    expect(fakes.toast.success).toHaveBeenCalledWith("Session deleted");
  });

  it("keep a refused delete open for a retry", async () => {
    fakes.remove.mockRejectedValueOnce(deleteRefusal()).mockResolvedValueOnce(undefined);
    mount();
    openFrom("Delete Draft plan");
    const dialog = screen.getByRole("alertdialog", { name: "Delete session" });
    const confirm = within(dialog).getByRole("button", { name: "Delete session" });

    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(fakes.toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Failed to delete: .*accept work only through their parent/),
    );
    expect(fakes.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBe(dialog);

    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(fakes.remove).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("put a refused delete of the open chat back on its route", async () => {
    fakes.remove.mockRejectedValueOnce(deleteRefusal());
    mount("/session/chat-1");
    openFrom("Delete Draft plan");

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete session" }),
      );
    });
    expect(location()).toBe("/session/chat-1");
    expect(fakes.remove).toHaveBeenCalledExactlyOnceWith("chat-1");
    expect(fakes.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("accept work only through their parent"),
    );
    expect(fakes.toast.success).not.toHaveBeenCalled();
  });
});
