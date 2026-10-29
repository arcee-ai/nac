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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

function Row() {
  const actions = useSessionActions();
  const location = useLocation();
  return (
    <>
      <ChatSessionActions
        title="Draft plan"
        onRename={() => actions.rename(summary)}
        onDelete={() => actions.remove(summary)}
      />
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

function mount(path = "/session/chat-2") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PresentationBoundary>
        <SessionActionsProvider>
          <Row />
        </SessionActionsProvider>
      </PresentationBoundary>
    </MemoryRouter>,
  );
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
  fakes.remove.mockReset();
  fakes.toast.success.mockReset();
  fakes.toast.error.mockReset();
});

afterEach(cleanup);

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
    const save = deferred();
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

    await act(async () => save.resolve());
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
      .mockResolvedValueOnce(undefined);
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
      .mockResolvedValueOnce(undefined);
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
    fakes.pending = true;
    mount();
    openFrom("Rename Draft plan");
    const dialog = screen.getByRole("dialog", { name: "Rename session" });

    const field = within(dialog).getByLabelText<HTMLInputElement>("Title");
    expect(field.readOnly).toBe(true);
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
    fakes.update.mockResolvedValue(undefined);
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
    const save = deferred();
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
    await act(async () => save.resolve());
    expect(screen.queryByRole("dialog")).toBeNull();
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
