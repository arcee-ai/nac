import { useState, type ReactNode } from "react";

import {
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Modal,
  Separator,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { LibraryPicker } from "@/app/components/modals/MCPServersModal/McpLibraryPicker";
import { McpServerForm } from "@/app/components/modals/MCPServersModal/McpServerForm";
import { useMcpLibrary, useMcpServers } from "@/app/services/queries";
import type { McpLibraryEntry } from "@/app/types/api";

/** A draft's origin: a catalog template, or nothing for a hand-written server. */
type Draft = { template: McpLibraryEntry | null };

/**
 * The phone has no room for the sidebar the desktop dialog puts the servers in,
 * so the panel itself is the list and everything it leads to opens as another
 * panel on top of it: list → catalog → form, each with its own way back.
 */
export function McpServersMobile({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: library } = useMcpLibrary();
  const { data, isLoading } = useMcpServers();
  const servers = data?.servers ?? [];
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [formFooter, setFormFooter] = useState<ReactNode>(null);

  const record = servers.find((entry) => entry.name === editing) ?? null;
  const template = draft?.template ?? null;
  // A stored server's catalog entry: by the recorded library id, or by name for
  // servers created before the id was recorded.
  const libraryEntry =
    template ??
    (record
      ? (library?.entries.find(
          (entry) => entry.id === record.library_id || entry.name === record.name,
        ) ?? null)
      : null);

  // Saving and deleting both finish the errand, so they land back on the list
  // rather than the catalog the draft came from.
  const backToList = () => {
    setDraft(null);
    setEditing(null);
    setPicking(false);
  };

  const closeForm = () => {
    setDraft(null);
    setEditing(null);
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="MCP servers">
        <div className="flex flex-col gap-1 [&>*]:shrink-0">
          <TabButton size={TabButtonSize.Large} onClick={() => setPicking(true)}>
            <Icon iconName={IconName.Add} />
            <span className="text-left flex-grow truncate">Add server</span>
            <Icon iconName={IconName.Right} className="shrink-0" />
          </TabButton>
          {servers.length ? <Separator /> : null}
          {servers.map((server) => (
            <TabButton
              key={server.name}
              size={TabButtonSize.Large}
              onClick={() => setEditing(server.name)}
            >
              <span className="text-left flex-grow truncate">{server.name}</span>
              <Icon iconName={IconName.Right} className="shrink-0" />
            </TabButton>
          ))}
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-1">
              <Loader size={LoaderSize.Micro} />
              <span className="text-micro text-basic-muted">Loading…</span>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Add server"
        bodyClassName="p-0 overflow-hidden flex flex-col"
      >
        <LibraryPicker
          onPick={(entry) => setDraft({ template: entry })}
          onCustom={() => setDraft({ template: null })}
        />
      </Modal>

      <Modal
        open={draft !== null || editing !== null}
        onClose={closeForm}
        title={record?.name ?? template?.name ?? "Custom server"}
        bodyClassName="p-0 overflow-hidden flex flex-col"
        footer={formFooter}
      >
        <McpServerForm
          key={record?.name ?? template?.id ?? "custom"}
          record={record}
          template={template}
          libraryEntry={libraryEntry}
          onClose={closeForm}
          onSaved={backToList}
          onDeleted={backToList}
          setFooter={setFormFooter}
        />
      </Modal>
    </>
  );
}
