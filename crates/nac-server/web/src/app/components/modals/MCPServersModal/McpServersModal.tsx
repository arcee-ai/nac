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
 * One header or env line of the form. `storedKey` marks a secret that lives
 * on the server under that key: the input shows the redacted preview as a
 * placeholder, and an empty value sends null so the stored value survives
 * untouched. A library template's auth row carries only a hint placeholder.
 */
interface KvRow {
  key: string;
  value: string;
  storedKey?: string;
  placeholder?: string;
}

function rowsFromRecord(map: Record<string, string>): KvRow[] {
  return Object.entries(map).map(([key, preview]) => ({
    key,
    value: "",
    storedKey: key,
    placeholder: preview,
  }));
}

/**
 * Literal map for create/test payloads; null borrows the stored secret. A
 * blank value with nothing stored drops the row instead of sending "". A
 * stored row whose key was renamed still sends null, so the server rejects
 * the save with a clear error instead of silently deleting the secret.
 */
function mapFromRows(rows: KvRow[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (!row.value) {
      if (row.storedKey) map[key] = null;
      continue;
    }
    map[key] = row.value;
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

/**
 * A footer action: a sticky bar button on mobile, a large button on desktop
 * (where the neutral action renders as a ghost button).
 */
function FooterButton({
  isMobile,
  variant,
  content,
  className,
  disabled,
  onClick,
  children,
}: {
  isMobile: boolean;
  variant: ButtonVariant;
  content?: ButtonContent;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  if (isMobile) {
    return (
      <StickyButton
        variant={variant}
        content={content ?? ButtonContent.Text}
        className={className}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </StickyButton>
    );
  }
  return (
    <Button
      size={ButtonSize.Large}
      variant={
        variant === ButtonVariant.Secondary ? ButtonVariant.Ghost : variant
      }
      content={content}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
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
  // Warms the catalog as soon as the modal opens, so the picker's grouped
  // sections are already there when "Add server" is selected.
  const { data: library } = useMcpLibrary();
  const { data, isLoading } = useMcpServers();
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
          (entry) =>
            entry.id === record.library_id || entry.name === record.name,
        ) ?? null)
      : null);

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
            isMobile={isMobile}
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
  const { data: serverData } = useMcpServers();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const entry of data?.entries ?? []) {
      if (!seen.includes(entry.category)) seen.push(entry.category);
    }
    return seen;
  }, [data]);
  // Entries already saved as a server: matched by the recorded library id,
  // or by name for servers created before the id was recorded.
  const installed = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const server of serverData?.servers ?? []) {
      if (server.library_id) ids.add(server.library_id);
      names.add(server.name);
    }
    return (entry: McpLibraryEntry) =>
      ids.has(entry.id) || names.has(entry.name);
  }, [serverData]);
  // Grouped by category before a search; a flat filtered list while typing.
  // A query searches names and descriptions, falling back to tags when
  // nothing matches directly.
  const sections = useMemo(() => {
    const all = (data?.entries ?? []).filter(
      (entry) => category === null || entry.category === category,
    );
    const needle = query.trim().toLowerCase();
    if (needle) {
      const direct = all.filter(
        (entry) =>
          entry.name.toLowerCase().includes(needle) ||
          entry.description.toLowerCase().includes(needle),
      );
      const matches =
        direct.length > 0
          ? direct
          : all.filter((entry) =>
              entry.tags.some((tag) => tag.toLowerCase().includes(needle)),
            );
      return matches.length > 0 ? [{ category: null, entries: matches }] : [];
    }
    const grouped: { category: string | null; entries: McpLibraryEntry[] }[] =
      [];
    for (const entry of all) {
      const section = grouped.find(
        (candidate) => candidate.category === entry.category,
      );
      if (section) {
        section.entries.push(entry);
      } else {
        grouped.push({ category: entry.category, entries: [entry] });
      }
    }
    return grouped;
  }, [data, query, category]);

  useLayoutEffect(() => {
    setFooter(
      <FooterButton
        isMobile={isMobile}
        variant={ButtonVariant.Secondary}
        onClick={onClose}
      >
        Close
      </FooterButton>,
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
        {categories.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {[null, ...categories].map((item) => (
              <Button
                key={item ?? "all"}
                size={ButtonSize.Small}
                variant={
                  category === item
                    ? ButtonVariant.Primary
                    : ButtonVariant.Secondary
                }
                content={ButtonContent.Text}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item ?? "All"}
              </Button>
            ))}
          </div>
        ) : null}
        {sections.map((section) => (
          <div
            key={section.category ?? "search"}
            className="flex flex-col gap-2 [&>*]:shrink-0"
          >
            {section.category !== null ? (
              <span className="text-micro text-basic-muted uppercase tracking-wide pt-2 px-1">
                {section.category}
              </span>
            ) : null}
            {section.entries.map((entry) => {
              const added = installed(entry);
              return (
                <TabButton
                  key={entry.id}
                  size={TabButtonSize.Large}
                  disabled={added}
                  className={cn(added && "opacity-50")}
                  onClick={() => onPick(entry)}
                >
                  <EntryThumbnail entry={entry} />
                  <div className="flex flex-col items-start text-left min-w-0 flex-grow py-1">
                    <div className="flex items-center gap-2">
                      <span className="code code-small text-basic-primary">
                        {entry.name}
                      </span>
                      {added ? (
                        <Badge text="Added" color={BadgeColor.Green} />
                      ) : entry.auth === "required_header" ? (
                        <Badge text="Key required" color={BadgeColor.Yellow} />
                      ) : null}
                    </div>
                    <span className="text-small text-basic-muted truncate w-full">
                      {entry.description}
                    </span>
                  </div>
                  {added ? null : (
                    <Icon iconName={IconName.Right} className="shrink-0" />
                  )}
                </TabButton>
              );
            })}
          </div>
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

/**
 * The entry's icon when it has one and it loads; its first letter otherwise.
 */
function EntryThumbnail({ entry }: { entry: McpLibraryEntry }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="flex items-center justify-center size-8 shrink-0 rounded-md bg-divider-muted overflow-hidden">
      {entry.icon_url && !broken ? (
        <img
          src={entry.icon_url}
          alt=""
          className="size-5 object-contain"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="text-small text-basic-muted uppercase">
          {entry.name.charAt(0)}
        </span>
      )}
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
  const update = (index: number, patch: Partial<KvRow>) => {
    onChange(
      rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
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
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            inputSize={InputSize.Medium}
            className="flex-1 min-w-0"
            placeholder={row.placeholder ?? "value"}
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
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
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Icon iconName={IconName.Add} />
        Add entry
      </Button>
    </div>
  );
}

/**
 * The catalog entry's identity and description as a card: thumbnail, name,
 * category, auth badge, docs link, and the description clamped to three
 * lines with a toggle when it overflows.
 */
function EntryDetails({ entry }: { entry: McpLibraryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const proseRef = useRef<HTMLSpanElement>(null);
  // The docs link renders separately, so an inline "Docs: <url>" fragment
  // (common in registry descriptions) is dropped from the prose.
  const description = entry.description
    .replace(/\bDocs:\s*https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // The toggle only appears when the clamp actually hides text.
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight);
  }, [description]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-muted p-3">
      <div className="flex items-center gap-2 min-w-0">
        <EntryThumbnail entry={entry} />
        <div className="flex flex-col min-w-0 flex-grow">
          <div className="flex items-center gap-2 min-w-0">
            <span className="code code-small text-basic-primary truncate">
              {entry.name}
            </span>
            {entry.auth === "required_header" ? (
              <Badge text="Key required" color={BadgeColor.Yellow} />
            ) : null}
          </div>
          <span className="text-micro text-basic-muted uppercase tracking-wide">
            {entry.category}
          </span>
        </div>
        <a
          href={entry.docs_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 shrink-0 text-small text-info-primary hover:underline"
        >
          <Icon iconName={IconName.BookOpen} />
          Docs
        </a>
      </div>
      {description ? (
        <>
          <span
            ref={proseRef}
            className={cn(
              "text-small text-basic-muted",
              !expanded && "line-clamp-3",
            )}
          >
            {description}
          </span>
          {clamped || expanded ? (
            <button
              type="button"
              className="self-start text-small text-basic-primary hover:underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function McpServerForm({
  record,
  template,
  libraryEntry,
  onBack,
  onClose,
  onSaved,
  onDeleted,
  setFooter,
  isMobile,
}: {
  record: McpServerView | null;
  template: McpLibraryEntry | null;
  libraryEntry: McpLibraryEntry | null;
  onBack: () => void;
  onClose: () => void;
  onSaved: (serverName: string) => void;
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
      toast.error(`Save failed: ${errorMessage(error)}`);
    }
  };

  const remove = async () => {
    if (!record) return;
    try {
      await deleteServer.mutateAsync(record.name);
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
          onClick={onClose}
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
  }, [busy, isMobile, onClose, record, setFooter]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
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
        <span className="text-small text-basic-primary truncate">
          {name.trim() || "Custom server"}
        </span>
      </div>
      <div
        className={cn(
          "flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0",
          isMobile && "pb-[88px]",
        )}
      >
        {libraryEntry ? <EntryDetails entry={libraryEntry} /> : null}

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
