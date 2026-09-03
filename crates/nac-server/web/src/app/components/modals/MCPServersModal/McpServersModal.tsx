import { useMemo, useState, type ReactNode } from "react";

import { Modal, ModalSize } from "@/app/atoms";
import { ConfigListNav } from "@/app/components/modals/ConfigListNav";
import { LibraryPicker } from "@/app/components/modals/MCPServersModal/McpLibraryPicker";
import { McpServerForm } from "@/app/components/modals/MCPServersModal/McpServerForm";
import { McpServersLoadError } from "@/app/components/modals/MCPServersModal/McpServersLoadError";
import { McpServersMobile } from "@/app/components/modals/MCPServersModal/McpServersMobile";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useMcpLibrary, useMcpServers } from "@/app/services/queries";
import type { McpLibraryEntry } from "@/app/types/api";

const DRAFT = "__new__";

export function McpServersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mounted = useExitTransition(open);
  const isMobile = useIsMobile();
  if (!mounted) return null;
  // The two layouts are different dialogs, not one dialog with breakpoints:
  // the phone stacks panels where the desktop puts a sidebar beside the form.
  if (isMobile) return <McpServersMobile open={open} onClose={onClose} />;
  return <McpServersManager open={open} onClose={onClose} />;
}

function McpServersManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Warms the catalog as soon as the modal opens, so the picker's grouped
  // sections are already there when "Add server" is selected.
  const { data: library } = useMcpLibrary();
  const { data, error, isError, isFetching, isLoading, refetch } = useMcpServers();
  const servers = useMemo(() => data?.servers ?? [], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [template, setTemplate] = useState<McpLibraryEntry | null>(null);
  const [customDraft, setCustomDraft] = useState(false);
  const [footer, setFooter] = useState<ReactNode>(null);
  const selected = picked ?? servers.at(-1)?.name ?? DRAFT;
  const record = servers.find((entry) => entry.name === selected) ?? null;
  const drafting = selected === DRAFT;

  const pick = (id: string) => {
    setPicked(id);
    setTemplate(null);
    setCustomDraft(false);
  };

  // The catalog entry behind the open form: the picked template for a draft,
  // the recorded library id (or name) for a stored server.
  const libraryEntry =
    template ??
    (record
      ? (library?.entries.find(
          (entry) => entry.id === record.library_id || entry.name === record.name,
        ) ?? null)
      : null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="MCP servers"
      size={ModalSize.Large}
      flush
      className="md:h-[740px]"
      bodyClassName="p-0 overflow-hidden"
      footer={footer}
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
        <div className="flex flex-col md:flex-row items-stretch h-full min-h-0">
          <ConfigListNav
            draftLabel="Add server"
            draftSelected={drafting}
            onSelectDraft={() => pick(DRAFT)}
            entries={servers.map((entry) => ({
              id: entry.name,
              name: entry.name,
            }))}
            selectedId={selected}
            onSelect={pick}
            isLoading={isLoading}
          />

          {drafting && !template && !customDraft ? (
            <LibraryPicker
              onPick={(entry) => setTemplate(entry)}
              onCustom={() => setCustomDraft(true)}
              onClose={onClose}
              setFooter={setFooter}
            />
          ) : (
            <McpServerForm
              key={record ? record.name : (template?.id ?? "custom")}
              record={record}
              template={template}
              libraryEntry={libraryEntry}
              onBack={() => {
                setPicked(DRAFT);
                setTemplate(null);
                setCustomDraft(false);
              }}
              onClose={onClose}
              onSaved={pick}
              onDeleted={() => pick(DRAFT)}
              setFooter={setFooter}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
