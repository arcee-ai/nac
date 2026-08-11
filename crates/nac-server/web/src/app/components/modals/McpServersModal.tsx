import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Modal,
  ModalSize,
  Select,
  Separator,
  StickyButton,
  Switch,
  TabButton,
  TabButtonSize,
  TextArea,
} from "@/app/atoms";
import { ConfigListNav } from "@/app/components/modals/ConfigListNav";
import { FieldLabel } from "@/app/components/modals/ConfigRow";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpLibrary,
  useMcpServers,
  useTestMcpServer,
  useUpdateMcpServer,
} from "@/app/services/queries";
import type {
  McpLibraryEntry,
  McpProbedTool,
  McpServerView,
  McpTransport,
} from "@/app/types/api";

const DRAFT = "__new__";

const TRANSPORT_ITEMS = [
  { id: "streamable_http", label: "Streamable HTTP" },
  { id: "stdio", label: "Stdio" },
];

/**
 * One header or env line of the form. `keepStored` marks a secret that lives
 * only on the server: the input shows the redacted preview as a placeholder,
 * and saving sends null so the stored value survives untouched.
 */
interface KvRow {
  key: string;
  value: string;
  keepStored: boolean;
  placeholder?: string;
}

function rowsFromRecord(map: Record<string, string>): KvRow[] {
  return Object.entries(map).map(([key, preview]) => ({
    key,
    value: "",
    keepStored: true,
    placeholder: preview,
  }));
}

/** Literal map for create/test payloads; null borrows the stored secret. */
function mapFromRows(rows: KvRow[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    map[key] = row.keepStored && !row.value ? null : row.value;
  }
  return map;
}

function literalsOnly(
  map: Record<string, string | null>,
): Record<string, string> {
  const literals: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== null) literals[key] = value;
  }
  return literals;
}

function splitArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function McpServersModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return <McpServersManager open={open} onClose={onClose} />;
}

function McpServersManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { data, isLoading } = useMcpServers();
  const servers = useMemo(() => data?.servers ?? [], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [template, setTemplate] = useState<McpLibraryEntry | null>(null);
  const [customDraft, setCustomDraft] = useState(false);
  const [footer, setFooter] = useState<ReactNode>(null);
  const selected = picked ?? servers.at(-1)?.config_id ?? DRAFT;
  const record =
    servers.find((entry) => entry.config_id === selected) ?? null;
  const drafting = selected === DRAFT;

  const pick = (id: string) => {
    setPicked(id);
    setTemplate(null);
    setCustomDraft(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="MCP servers"
      size={ModalSize.Large}
      flush
      className="max-w-[780px] md:h-[540px]"
      bodyClassName="p-0 overflow-hidden"
      footer={footer}
    >
      <div className="flex flex-col md:flex-row items-stretch h-full min-h-0">
        <ConfigListNav
          draftLabel="Add server"
          draftSelected={drafting}
          onSelectDraft={() => pick(DRAFT)}
          entries={servers.map((entry) => ({
            id: entry.config_id,
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
            isMobile={isMobile}
          />
        ) : (
          <McpServerForm
            key={record ? record.config_id : (template?.id ?? "custom")}
            record={record}
            template={template}
            onClose={onClose}
            onSaved={pick}
            onDeleted={() => pick(DRAFT)}
            setFooter={setFooter}
            isMobile={isMobile}
          />
        )}
      </div>
    </Modal>
  );
}

/**
 * The curated catalog. Embedded in the binary today; entries will later come
 * from a remote index, so the picker treats the list as data either way.
 */
function LibraryPicker({
  onPick,
  onCustom,
  onClose,
  setFooter,
  isMobile,
}: {
  onPick: (entry: McpLibraryEntry) => void;
  onCustom: () => void;
  onClose: () => void;
  setFooter: (footer: ReactNode) => void;
  isMobile: boolean;
}) {
  const { data } = useMcpLibrary();
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle),
    );
  }, [data, query]);

  useLayoutEffect(() => {
    setFooter(
      isMobile ? (
        <StickyButton
          variant={ButtonVariant.Secondary}
          content={ButtonContent.Text}
          onClick={onClose}
        >
          Close
        </StickyButton>
      ) : (
        <Button
          size={ButtonSize.Large}
          variant={ButtonVariant.Ghost}
          onClick={onClose}
        >
          Close
        </Button>
      ),
    );
    return () => setFooter(null);
  }, [isMobile, onClose, setFooter]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div
        className={cn(
          "flex-1 overflow-auto p-4 flex flex-col gap-2 [&>*]:shrink-0",
          isMobile && "pb-[88px]",
        )}
      >
        <Input
          inputSize={InputSize.Medium}
          leading={InputLeading.Icon}
          leadingIconName={IconName.Search}
          placeholder="Search the library"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {entries.map((entry) => (
          <TabButton
            key={entry.id}
            size={TabButtonSize.Large}
            onClick={() => onPick(entry)}
          >
            <div className="flex flex-col items-start text-left min-w-0 flex-grow py-1">
              <div className="flex items-center gap-2">
                <span className="code code-small text-basic-primary">
                  {entry.name}
                </span>
                {entry.auth === "required_header" ? (
                  <Badge text="Key required" color={BadgeColor.Yellow} />
                ) : null}
              </div>
              <span className="text-small text-basic-muted truncate w-full">
                {entry.description}
              </span>
            </div>
            <Icon iconName={IconName.Right} className="shrink-0" />
          </TabButton>
        ))}
        <Separator />
        <TabButton size={TabButtonSize.Large} onClick={onCustom}>
          <Icon iconName={IconName.Add} />
          <span className="text-left flex-grow">Custom server</span>
        </TabButton>
      </div>
    </div>
  );
}

function KvEditor({
  label,
  hint,
  keyPlaceholder,
  rows,
  onChange,
}: {
  label: string;
  hint: string;
  keyPlaceholder: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
}) {
  const updateKey = (index: number, key: string) => {
    onChange(rows.map((row, at) => (at === index ? { ...row, key } : row)));
  };
  // A cleared value falls back to keeping the stored secret when the row came
  // from the server; only a typed literal replaces it.
  const updateValue = (index: number, value: string) => {
    onChange(
      rows.map((row, at) =>
        at === index
          ? {
              ...row,
              value,
              keepStored: value === "" && row.placeholder !== undefined,
            }
          : row,
      ),
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel label={label} hint={hint} />
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            inputSize={InputSize.Medium}
            className="flex-1 min-w-0"
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(event) => updateKey(index, event.target.value)}
          />
          <Input
            inputSize={InputSize.Medium}
            className="flex-1 min-w-0"
            placeholder={row.keepStored ? row.placeholder : "value"}
            value={row.value}
            onChange={(event) => updateValue(index, event.target.value)}
          />
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="Remove entry"
            onClick={() => onChange(rows.filter((_, at) => at !== index))}
          >
            <Icon iconName={IconName.Trash} />
          </Button>
        </div>
      ))}
      <Button
        size={ButtonSize.Medium}
        variant={ButtonVariant.Secondary}
        className="self-start"
        onClick={() =>
          onChange([...rows, { key: "", value: "", keepStored: false }])
        }
      >
        <Icon iconName={IconName.Add} />
        Add entry
      </Button>
    </div>
  );
}

function McpServerForm({
  record,
  template,
  onClose,
  onSaved,
  onDeleted,
  setFooter,
  isMobile,
}: {
  record: McpServerView | null;
  template: McpLibraryEntry | null;
  onClose: () => void;
  onSaved: (configId: string) => void;
  onDeleted: () => void;
  setFooter: (footer: ReactNode) => void;
  isMobile: boolean;
}) {
  const toast = useToast();
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const testServer = useTestMcpServer();

  const [name, setName] = useState(record?.name ?? template?.name ?? "");
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [transport, setTransport] = useState<McpTransport>(
    record?.transport ?? template?.transport ?? "streamable_http",
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
          keepStored: false,
          placeholder: template.auth_hint ?? undefined,
        },
      ];
    }
    return [];
  });
  const [env, setEnv] = useState<KvRow[]>(
    record ? rowsFromRecord(record.env) : [],
  );
  const [tools, setTools] = useState<McpProbedTool[] | null>(null);

  const busy =
    createServer.isPending ||
    updateServer.isPending ||
    deleteServer.isPending ||
    testServer.isPending;

  const validate = (): string | null => {
    if (!name.trim()) return "A name is required.";
    if (transport === "streamable_http" && !url.trim())
      return "A URL is required.";
    if (transport === "stdio" && !command.trim())
      return "A command is required.";
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
          headers:
            transport === "streamable_http" ? literalsOnly(headerMap) : {},
          library_id: template?.id ?? null,
        });
        onSaved(created.config_id);
        toast.success("MCP server saved.");
      } else {
        await updateServer.mutateAsync({
          configId: record.config_id,
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
        toast.success("MCP server updated.");
      }
    } catch (error) {
      toast.error(`Save failed: ${errorMessage(error)}`);
    }
  };

  const remove = async () => {
    if (!record) return;
    try {
      await deleteServer.mutateAsync(record.config_id);
      onDeleted();
      toast.success("MCP server deleted.");
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(error)}`);
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
        config_id: record?.config_id ?? null,
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
      toast.error(`Test failed: ${errorMessage(error)}`);
    }
  };

  const saveRef = useRef(save);
  const removeRef = useRef(remove);

  useLayoutEffect(() => {
    saveRef.current = save;
    removeRef.current = remove;
  });

  useLayoutEffect(() => {
    setFooter(
      <>
        {record ? (
          isMobile ? (
            <StickyButton
              variant={ButtonVariant.SecondaryDestructive}
              content={ButtonContent.Icon}
              className="mr-auto"
              disabled={busy}
              onClick={() => void removeRef.current()}
            >
              <Icon iconName={IconName.Trash} />
            </StickyButton>
          ) : (
            <Button
              size={ButtonSize.Large}
              variant={ButtonVariant.SecondaryDestructive}
              content={ButtonContent.Icon}
              className="mr-auto"
              disabled={busy}
              onClick={() => void removeRef.current()}
            >
              <Icon iconName={IconName.Trash} />
            </Button>
          )
        ) : null}
        {isMobile ? (
          <StickyButton
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={onClose}
          >
            Cancel
          </StickyButton>
        ) : (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Ghost}
            onClick={onClose}
          >
            Cancel
          </Button>
        )}
        {isMobile ? (
          <StickyButton
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            disabled={busy}
            onClick={() => void saveRef.current()}
          >
            Save
          </StickyButton>
        ) : (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Primary}
            disabled={busy}
            onClick={() => void saveRef.current()}
          >
            Save
          </Button>
        )}
      </>,
    );
    return () => setFooter(null);
  }, [busy, isMobile, onClose, record, setFooter]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div
        className={cn(
          "flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0",
          isMobile && "pb-[88px]",
        )}
      >
        {template ? (
          <div className="text-small text-basic-muted">
            {template.description}{" "}
            <a
              href={template.docs_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-info-primary underline"
            >
              Docs
            </a>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <FieldLabel label="Name" required />
          <Input
            inputSize={InputSize.Medium}
            placeholder="my_server"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <FieldLabel
            label="Enabled"
            hint="Disabled servers are kept but not connected when a session starts."
          />
          <Switch checked={enabled} onChange={setEnabled} />
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel label="Transport" />
          <Select
            items={TRANSPORT_ITEMS}
            value={transport}
            onValueChange={(id) => setTransport(id as McpTransport)}
            triggerClassName="w-full"
            className="w-full"
          />
        </div>

        {transport === "streamable_http" ? (
          <>
            <div className="flex flex-col gap-1">
              <FieldLabel label="URL" required />
              <Input
                inputSize={InputSize.Medium}
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
                inputSize={InputSize.Medium}
                placeholder="npx"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel label="Arguments" hint="One argument per line." />
              <TextArea
                textAreaClassName="min-h-[72px] font-mono"
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

        <Separator />

        <div className="flex items-center gap-2">
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Secondary}
            disabled={busy}
            onClick={() => void test()}
          >
            {testServer.isPending ? "Testing…" : "Test connection"}
          </Button>
          {tools ? (
            <span className="text-small text-basic-muted">
              {tools.length} tool{tools.length === 1 ? "" : "s"} found
            </span>
          ) : null}
        </div>

        {tools && tools.length ? (
          <div className="flex flex-col gap-1">
            {tools.map((tool) => (
              <div key={tool.name} className="flex items-baseline gap-2 min-w-0">
                <span className="code code-small text-basic-primary shrink-0">
                  {tool.name}
                </span>
                {tool.description ? (
                  <span className="text-small text-basic-muted truncate">
                    {tool.description}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
