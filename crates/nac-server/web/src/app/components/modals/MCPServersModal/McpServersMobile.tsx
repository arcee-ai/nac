import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
import { McpServersLoadError } from "@/app/components/modals/MCPServersModal/McpServersLoadError";
import { useMcpLibrary, useMcpServers } from "@/app/services/queries";
import type { McpLibraryEntry } from "@/app/types/api";

/** A draft's origin: a catalog template, or nothing for a hand-written server. */
type Draft = { template: McpLibraryEntry | null };

// Keep phone actions large enough and reserve the footer's actual wrapped height.
const mobileModalClassName =
  "max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11 max-md:[&>header_div:has(>.btn-sticky)]:min-w-11 [&>.modal-footer-mobile]:relative [&>.modal-footer-mobile]:shrink-0 [&>.modal-footer-mobile]:flex-wrap [&>.modal-footer-mobile_.btn-sticky]:min-h-11 [&>.modal-footer-mobile_.btn-sticky]:min-w-11 [&>.modal-footer-mobile>div]:min-h-11 [&>.modal-footer-mobile>div]:min-w-11";

// Keep paint order stable when the form reopens during its retained exit.
const mobileModalZIndex = { list: 100, catalog: 101, form: 102 } as const;

/**
 * The phone has no room for the sidebar the desktop dialog puts the servers in,
 * so the panel itself is the list and everything it leads to opens as another
 * panel on top of it: list → catalog → form, each with its own way back.
 */
export function McpServersMobile({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: library } = useMcpLibrary();
  const { data, error, isError, isFetching, isLoading, refetch } = useMcpServers();
  const servers = data?.servers ?? [];
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [formFooter, setFormFooter] = useState<ReactNode>(null);
  // A closing phone form remains mounted; only its current selection may finish navigation.
  const formEpoch = useRef(0);
  const currentFormEpoch = formEpoch.current;
  useLayoutEffect(() => {
    if (!open) formEpoch.current += 1;
  }, [open]);

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
    formEpoch.current += 1;
    setDraft(null);
    setEditing(null);
    setPicking(false);
  };

  const closeForm = () => {
    formEpoch.current += 1;
    setDraft(null);
    setEditing(null);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="MCP servers"
        className={mobileModalClassName}
        zIndex={mobileModalZIndex.list}
      >
        {isError ? (
          <McpServersLoadError
            error={error}
            retrying={isFetching}
            onRetry={() => {
              void refetch();
            }}
          />
        ) : (
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
                onClick={() => {
                  formEpoch.current += 1;
                  setEditing(server.name);
                }}
              >
                <span className="text-left flex-grow truncate">{server.name}</span>
                <Icon iconName={IconName.Right} className="shrink-0" />
              </TabButton>
            ))}
            {isLoading ? (
              <div className="flex items-center gap-2 px-2 py-1">
                <Loader size={LoaderSize.XSmall} />
                <span className="text-micro text-basic-muted">Loading…</span>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Add server"
        className={mobileModalClassName}
        zIndex={mobileModalZIndex.catalog}
        bodyClassName="p-0 overflow-hidden flex flex-col"
      >
        <LibraryPicker
          onPick={(entry) => {
            formEpoch.current += 1;
            setDraft({ template: entry });
          }}
          onCustom={() => {
            formEpoch.current += 1;
            setDraft({ template: null });
          }}
        />
      </Modal>

      <Modal
        open={draft !== null || editing !== null}
        onClose={closeForm}
        title={record?.name ?? template?.name ?? "Custom server"}
        className={mobileModalClassName}
        zIndex={mobileModalZIndex.form}
        bodyClassName="p-0 overflow-hidden flex flex-col"
        footer={formFooter}
      >
        <McpServerForm
          key={record?.name ?? template?.id ?? "custom"}
          record={record}
          template={template}
          libraryEntry={libraryEntry}
          onClose={closeForm}
          onSaved={() => {
            if (formEpoch.current === currentFormEpoch) backToList();
          }}
          onDeleted={() => {
            if (formEpoch.current === currentFormEpoch) backToList();
          }}
          isCurrent={() => formEpoch.current === currentFormEpoch}
          setFooter={setFormFooter}
        />
      </Modal>
    </>
  );
}
