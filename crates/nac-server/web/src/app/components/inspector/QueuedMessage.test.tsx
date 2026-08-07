import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QueuedMessage } from "@/app/components/inspector/QueuedMessage";
import type { QueuedRunRecord } from "@/app/types/api";

const message: QueuedRunRecord = {
  session_id: "session-1",
  queued_run_id: "queued-1",
  client_message_id: "client-1",
  display_prompt: "Original next turn",
  agent_prompt: "Original next turn",
  after_run_id: "run-1",
  state: "pending",
  admitted_run_id: null,
  version: 3,
  created_at: "2026-08-07T00:00:00Z",
  updated_at: "2026-08-07T00:00:00Z",
};

describe("QueuedMessage", () => {
  it("labels the noncanonical next turn and edits it with version CAS", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <QueuedMessage message={message} onEdit={onEdit} onDelete={vi.fn()} />,
    );

    expect(screen.getByRole("region", { name: "Next message" })).toHaveTextContent(
      "Sends after the current run finishes",
    );
    await user.click(screen.getByRole("button", { name: "Edit next message" }));
    const editor = screen.getByRole("textbox", { name: "Edit next message" });
    await user.clear(editor);
    await user.type(editor, "Updated next turn");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onEdit).toHaveBeenCalledWith("Updated next turn", 3);
  });

  it("deletes with the displayed version", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <QueuedMessage message={message} onEdit={vi.fn()} onDelete={onDelete} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete next message" }));
    expect(onDelete).toHaveBeenCalledWith(3);
  });
});
