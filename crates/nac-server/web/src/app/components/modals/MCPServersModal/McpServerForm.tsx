import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Switch,
  SwitchSize,
  TextArea,
} from "@/app/atoms";
import { FieldLabel } from "@/app/components/modals/ConfigRow";
import { EntryDetails } from "@/app/components/modals/MCPServersModal/McpEntryDetails";
import { KvEditor } from "@/app/components/modals/MCPServersModal/McpKvEditor";
import { FooterButton } from "@/app/components/modals/ModalFooterButton";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { literalsOnly, mapFromRows, rowsFromRecord, type KvRow } from "@/app/lib/mcpKvRows";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useTestMcpServer,
  useUpdateMcpServer,
} from "@/app/services/queries";
import type { McpLibraryEntry, McpProbedTool, McpServerView, McpTransport } from "@/app/types/api";

const TRANSPORT_ITEMS: { id: McpTransport; label: string }[] = [
  { id: "streamable_http", label: "Streamable HTTP" },
  { id: "stdio", label: "Stdio" },
];

function splitArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function knownTransport(value: string | null | undefined): McpTransport {
  return value === "stdio" || value === "streamable_http" ? value : "streamable_http";
}

export function McpServerForm({
  record,
  template,
  libraryEntry,
  onBack,
  onClose,
  onSaved,
  onDeleted,
  setFooter,
}: {
  record: McpServerView | null;
  template: McpLibraryEntry | null;
  libraryEntry: McpLibraryEntry | null;
  /**
   * Way back to the catalog, as a row above the fields. A phone panel opens
   * the form as a dialog of its own and leads its header with the same move,
   * so there it is left out.
   */
  onBack?: () => void;
  onClose: () => void;
  onSaved: (serverName: string) => void;
  onDeleted: () => void;
  setFooter: (footer: ReactNode) => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const testServer = useTestMcpServer();

  const [name, setName] = useState(record?.name ?? template?.name ?? "");
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [transport, setTransport] = useState<McpTransport>(() =>
    knownTransport(record?.transport ?? template?.transport),
  );
  const [url, setUrl] = useState(record?.url ?? template?.url ?? "");
  const [command, setCommand] = useState(record?.command ?? "");
  const [argsText, setArgsText] = useState(record?.args.join("\n") ?? "");
  const [headers, setHeaders] = useState<KvRow[]>(() => {
    if (record) return rowsFromRecord(record.headers);
    if (template?.auth_header) {
      return [
        {
          key: template.auth_header,
          value: "",
          placeholder: template.auth_hint ?? undefined,
        },
      ];
    }
    return [];
  });
  const [env, setEnv] = useState<KvRow[]>(record ? rowsFromRecord(record.env) : []);
  const [tools, setTools] = useState<McpProbedTool[] | null>(null);

  const busy =
    createServer.isPending ||
    updateServer.isPending ||
    deleteServer.isPending ||
    testServer.isPending;

  const validate = (): string | null => {
    if (!name.trim()) return "A name is required.";
    if (transport === "streamable_http" && !url.trim()) return "A URL is required.";
    if (transport === "stdio" && !command.trim()) return "A command is required.";
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    const headerMap = mapFromRows(headers);
    const envMap = mapFromRows(env);
    try {
      if (!record) {
        const created = await createServer.mutateAsync({
          name: name.trim(),
          enabled,
          transport,
          command: transport === "stdio" ? command.trim() : null,
          args: transport === "stdio" ? splitArgs(argsText) : [],
          env: transport === "stdio" ? literalsOnly(envMap) : {},
          url: transport === "streamable_http" ? url.trim() : null,
          headers: transport === "streamable_http" ? literalsOnly(headerMap) : {},
          library_id: template?.id ?? null,
        });
        onSaved(created.name);
        toast.success("MCP server saved.");
      } else {
        const updated = await updateServer.mutateAsync({
          serverName: record.name,
          payload: {
            name: name.trim(),
            enabled,
            transport,
            command: transport === "stdio" ? command.trim() : null,
            args: transport === "stdio" ? splitArgs(argsText) : [],
            env: transport === "stdio" ? envMap : {},
            url: transport === "streamable_http" ? url.trim() : null,
            headers: transport === "streamable_http" ? headerMap : {},
          },
        });
        onSaved(updated.name);
        toast.success("MCP server updated.");
      }
    } catch (error) {
      toast.error(`Save failed: ${errorMessage(toRunError(error))}`);
    }
  };

  const remove = async () => {
    if (!record) return;
    try {
      await deleteServer.mutateAsync(record.name);
      onDeleted();
      toast.success("MCP server deleted.");
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(toRunError(error))}`);
    }
  };

  const test = async () => {
    const problem =
      transport === "streamable_http" && !url.trim()
        ? "A URL is required to test."
        : transport === "stdio" && !command.trim()
          ? "A command is required to test."
          : null;
    if (problem) {
      toast.error(problem);
      return;
    }
    setTools(null);
    try {
      const result = await testServer.mutateAsync({
        stored_name: record?.name ?? null,
        name: name.trim() || null,
        transport,
        command: transport === "stdio" ? command.trim() : null,
        args: transport === "stdio" ? splitArgs(argsText) : [],
        env: transport === "stdio" ? mapFromRows(env) : {},
        url: transport === "streamable_http" ? url.trim() : null,
        headers: transport === "streamable_http" ? mapFromRows(headers) : {},
      });
      setTools(result.tools);
      toast.success(
        `Connection succeeded: ${result.tools.length} tool${
          result.tools.length === 1 ? "" : "s"
        } found.`,
      );
    } catch (error) {
      toast.error(`Test failed: ${errorMessage(toRunError(error))}`);
    }
  };

  // The footer is built once per state that changes its shape, and reaches the
  // handlers through refs. Without that, a caller whose callbacks are rebuilt
  // every render would have the effect below setting a footer that causes the
  // render that rebuilds the callbacks — React stops that as a runaway loop.
  const saveRef = useRef(save);
  const removeRef = useRef(remove);
  const closeRef = useRef(onClose);

  useLayoutEffect(() => {
    saveRef.current = save;
    removeRef.current = remove;
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    setFooter(
      <>
        {record ? (
          <FooterButton
            isMobile={isMobile}
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Icon}
            className="mr-auto"
            disabled={busy}
            onClick={() => void removeRef.current()}
          >
            <Icon iconName={IconName.Trash} />
          </FooterButton>
        ) : null}
        <FooterButton
          isMobile={isMobile}
          variant={ButtonVariant.Secondary}
          onClick={() => closeRef.current()}
        >
          Cancel
        </FooterButton>
        <FooterButton
          isMobile={isMobile}
          variant={ButtonVariant.Primary}
          disabled={busy}
          onClick={() => void saveRef.current()}
        >
          Save
        </FooterButton>
      </>,
    );
    return () => setFooter(null);
  }, [busy, isMobile, record, setFooter]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {onBack ? (
        <div className="flex items-center gap-1 shrink-0 border-b border-muted px-2 py-2">
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="Back to library"
            onClick={onBack}
          >
            <Icon iconName={IconName.Left} />
          </Button>
          <span className="text-medium text-basic-primary truncate">
            {name.trim() || "Custom server"}
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0",
          isMobile && "pb-[88px]",
        )}
      >
        {libraryEntry ? <EntryDetails entry={libraryEntry} /> : null}

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex flex-col gap-1 flex-grow">
            <FieldLabel label="Name" required />
            <Input
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
              placeholder="my_server"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="md:pt-6">
            <div className="flex gap-4 items-center px-4 py-2 rounded-md bg-elevation-sublevel-variant-A shadow-convex">
              <FieldLabel
                label="Enabled"
                hint="Disabled servers are kept but not connected when a session starts."
              />
              <Switch
                checked={enabled}
                size={isMobile ? SwitchSize.Large : SwitchSize.Medium}
                onChange={setEnabled}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex">
          <div className="flex flex-col gap-1">
            <FieldLabel label="Transport" />
            {/* Two choices, and which one is picked decides which half of the
              form follows, so both stay visible instead of hiding behind a
              select's closed trigger. */}
            <div className="flex gap-2">
              {TRANSPORT_ITEMS.map((item) => (
                <Button
                  key={item.id}
                  size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
                  variant={transport === item.id ? ButtonVariant.Primary : ButtonVariant.Secondary}
                  content={ButtonContent.Text}
                  aria-pressed={transport === item.id}
                  onClick={() => setTransport(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          {transport === "streamable_http" ? (
            <>
              <div className="flex flex-col gap-1">
                <FieldLabel label="URL" required />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  placeholder="https://example.com/mcp"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <KvEditor
                label="Headers"
                hint="Sent with every request. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again."
                keyPlaceholder="Authorization"
                rows={headers}
                onChange={setHeaders}
              />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <FieldLabel label="Command" required />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  placeholder="npx"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel label="Arguments" hint="One argument per line." />
                <TextArea
                  textAreaClassName={cn(
                    "min-h-[72px] font-mono",
                    isMobile ? "text-medium" : "text-small",
                  )}
                  placeholder={"-y\nsome-mcp-server"}
                  value={argsText}
                  onChange={(event) => setArgsText(event.target.value)}
                />
              </div>
              <KvEditor
                label="Environment"
                hint="Set for the server process. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again."
                keyPlaceholder="API_KEY"
                rows={env}
                onChange={setEnv}
              />
            </>
          )}

          <div className="flex items-center gap-2 justify-end">
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Secondary}
              disabled={busy}
              onClick={() => void test()}
              content={ButtonContent.IconLeft}
            >
              <Icon iconName={IconName.Bolt} />
              {testServer.isPending ? "Testing…" : "Test connection"}
            </Button>
            {tools ? (
              <span className="text-small text-basic-muted">
                {tools.length} tool{tools.length === 1 ? "" : "s"} found
              </span>
            ) : null}
          </div>
        </div>
        {tools && tools.length ? (
          <div className="flex flex-col gap-1">
            {tools.map((tool) => (
              <div key={tool.name} className="flex items-baseline gap-2 min-w-0">
                <span className="code code-small text-basic-primary shrink-0">{tool.name}</span>
                {tool.description ? (
                  <span className="text-small text-basic-muted truncate">{tool.description}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
