import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";

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
import { ClientRequestError } from "@/app/effect/errors";
import { readAsync } from "@/app/effect/remote";
import { cn } from "@/app/lib/cn";
import { literalsOnly, mapFromRows, rowsFromRecord, type KvRow } from "@/app/lib/mcpKvRows";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import {
  createMcpServerAtom,
  deleteMcpServerAtom,
  mcpRuntimeActionAtom,
  mcpRuntimeAtom,
  testMcpServerAtom,
  updateMcpServerAtom,
} from "@/app/services/queries";
import type {
  McpLibraryEntry,
  McpProbedTool,
  McpProtocolSelection,
  McpServerView,
  McpTransport,
} from "@/app/types/api";

function commandError(cause: unknown): unknown {
  return cause instanceof ClientRequestError ? cause.error : cause;
}

const TRANSPORT_ITEMS: { id: McpTransport; label: string }[] = [
  { id: "streamable_http", label: "Streamable HTTP" },
  { id: "stdio", label: "Stdio" },
];

const PROTOCOL_ITEMS: { id: McpProtocolSelection; label: string; hint: string }[] = [
  { id: "legacy", label: "Legacy", hint: "Use the 2025-11-25 initialize handshake." },
  {
    id: "auto",
    label: "Auto",
    hint: "Try 2026-07-28 discovery, then safely fall back to legacy.",
  },
  { id: "current", label: "Current", hint: "Require 2026-07-28 stateless discovery." },
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

function optionalMillis(value: string): number | null {
  return value.trim() ? Number(value) : null;
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
  const createServer = useAtomSet(createMcpServerAtom, { mode: "promise" });
  const creatingServer = useAtomValue(createMcpServerAtom).waiting;
  const updateServer = useAtomSet(updateMcpServerAtom, { mode: "promise" });
  const updatingServer = useAtomValue(updateMcpServerAtom).waiting;
  const deleteServer = useAtomSet(deleteMcpServerAtom, { mode: "promise" });
  const deletingServer = useAtomValue(deleteMcpServerAtom).waiting;
  const testServer = useAtomSet(testMcpServerAtom, { mode: "promise" });
  const testingServer = useAtomValue(testMcpServerAtom).waiting;
  const runtimeStatus = readAsync(useAtomValue(mcpRuntimeAtom));
  const runtimeAction = useAtomSet(mcpRuntimeActionAtom, { mode: "promise" });
  const runtimeActionWaiting = useAtomValue(mcpRuntimeActionAtom).waiting;

  const [name, setName] = useState(record?.name ?? template?.name ?? "");
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [required, setRequired] = useState(record?.required ?? false);
  const [protocol, setProtocol] = useState<McpProtocolSelection>(record?.protocol ?? "legacy");
  const [transport, setTransport] = useState<McpTransport>(() =>
    knownTransport(record?.transport ?? template?.transport),
  );
  const [url, setUrl] = useState(record?.url ?? template?.url ?? "");
  const [command, setCommand] = useState(record?.command ?? "");
  const [argsText, setArgsText] = useState(record?.args.join("\n") ?? "");
  const [cwd, setCwd] = useState(record?.cwd ?? "");
  const [envVarsText, setEnvVarsText] = useState(record?.env_vars.join("\n") ?? "");
  const [startupTimeout, setStartupTimeout] = useState(
    record?.startup_timeout_ms?.toString() ?? "",
  );
  const [catalogTimeout, setCatalogTimeout] = useState(
    record?.catalog_timeout_ms?.toString() ?? "",
  );
  const [executionTimeout, setExecutionTimeout] = useState(
    record?.execution_timeout_ms?.toString() ?? "",
  );
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
  const [envHeaders, setEnvHeaders] = useState<KvRow[]>(() =>
    Object.entries(record?.env_headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState(record?.bearer_token_env_var ?? "");
  const [helperCommand, setHelperCommand] = useState(record?.header_helper?.command ?? "");
  const [helperArgsText, setHelperArgsText] = useState(
    record?.header_helper?.args?.join("\n") ?? "",
  );
  const [helperCwd, setHelperCwd] = useState(record?.header_helper?.cwd ?? "");
  const [helperEnv, setHelperEnv] = useState<KvRow[]>(() =>
    record?.header_helper ? rowsFromRecord(record.header_helper.env ?? {}) : [],
  );
  const [helperEnvVarsText, setHelperEnvVarsText] = useState(
    record?.header_helper?.env_vars?.join("\n") ?? "",
  );
  const [helperTimeout, setHelperTimeout] = useState(
    record?.header_helper?.timeout_ms?.toString() ?? "",
  );
  const [tools, setTools] = useState<McpProbedTool[] | null>(null);
  const runtime = runtimeStatus.data?.servers.find((status) => status.name === record?.name);

  const busy = creatingServer || updatingServer || deletingServer || testingServer;
  // Runtime operations are serialized server-side as well.
  const operationBusy = busy || runtimeActionWaiting;

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
    const helper = helperCommand.trim()
      ? {
          command: helperCommand.trim(),
          args: splitArgs(helperArgsText),
          cwd: helperCwd.trim() || null,
          env: mapFromRows(helperEnv),
          env_vars: splitArgs(helperEnvVarsText),
          timeout_ms: optionalMillis(helperTimeout),
        }
      : null;
    try {
      if (!record) {
        const created = await createServer({
          name: name.trim(),
          enabled,
          required,
          startup_timeout_ms: optionalMillis(startupTimeout),
          catalog_timeout_ms: optionalMillis(catalogTimeout),
          execution_timeout_ms: optionalMillis(executionTimeout),
          protocol,
          transport,
          command: transport === "stdio" ? command.trim() : null,
          args: transport === "stdio" ? splitArgs(argsText) : [],
          env: transport === "stdio" ? literalsOnly(envMap) : {},
          env_vars: transport === "stdio" ? splitArgs(envVarsText) : [],
          cwd: transport === "stdio" ? cwd.trim() || null : null,
          url: transport === "streamable_http" ? url.trim() : null,
          headers: transport === "streamable_http" ? literalsOnly(headerMap) : {},
          env_headers: transport === "streamable_http" ? literalsOnly(mapFromRows(envHeaders)) : {},
          bearer_token_env_var:
            transport === "streamable_http" ? bearerTokenEnvVar.trim() || null : null,
          header_helper:
            transport === "streamable_http" && helper
              ? { ...helper, env: literalsOnly(helper.env) }
              : null,
          library_id: template?.id ?? null,
        });
        onSaved(created.name);
        toast.success("MCP server saved.");
      } else {
        const updated = await updateServer({
          serverName: record.name,
          payload: {
            name: name.trim(),
            enabled,
            required,
            startup_timeout_ms: optionalMillis(startupTimeout),
            catalog_timeout_ms: optionalMillis(catalogTimeout),
            execution_timeout_ms: optionalMillis(executionTimeout),
            protocol,
            transport,
            command: transport === "stdio" ? command.trim() : null,
            args: transport === "stdio" ? splitArgs(argsText) : [],
            env: transport === "stdio" ? envMap : {},
            env_vars: transport === "stdio" ? splitArgs(envVarsText) : [],
            cwd: transport === "stdio" ? cwd.trim() || null : null,
            url: transport === "streamable_http" ? url.trim() : null,
            headers: transport === "streamable_http" ? headerMap : {},
            env_headers:
              transport === "streamable_http" ? literalsOnly(mapFromRows(envHeaders)) : {},
            bearer_token_env_var:
              transport === "streamable_http" ? bearerTokenEnvVar.trim() || null : null,
            header_helper: transport === "streamable_http" ? helper : null,
          },
        });
        onSaved(updated.name);
        toast.success("MCP server updated.");
      }
    } catch (error) {
      toast.error(`Save failed: ${errorMessage(toRunError(commandError(error)))}`);
    }
  };

  const remove = async () => {
    if (!record) return;
    try {
      await deleteServer(record.name);
      onDeleted();
      toast.success("MCP server deleted.");
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(toRunError(commandError(error)))}`);
    }
  };

  const operate = async (action: "connect" | "disconnect" | "reload") => {
    if (!record) return;
    try {
      const status = await runtimeAction({ serverName: record.name, action });
      if (status.state === "failed") {
        toast.error(status.error ?? "MCP runtime operation failed.");
      } else {
        toast.success(`MCP server is ${status.state}.`);
      }
    } catch (error) {
      toast.error(`Runtime operation failed: ${errorMessage(toRunError(error))}`);
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
      const result = await testServer({
        stored_name: record?.name ?? null,
        name: name.trim() || null,
        transport,
        command: transport === "stdio" ? command.trim() : null,
        args: transport === "stdio" ? splitArgs(argsText) : [],
        env: transport === "stdio" ? mapFromRows(env) : {},
        env_vars: transport === "stdio" ? splitArgs(envVarsText) : [],
        cwd: transport === "stdio" ? cwd.trim() || null : null,
        url: transport === "streamable_http" ? url.trim() : null,
        headers: transport === "streamable_http" ? mapFromRows(headers) : {},
        env_headers: transport === "streamable_http" ? literalsOnly(mapFromRows(envHeaders)) : {},
        bearer_token_env_var:
          transport === "streamable_http" ? bearerTokenEnvVar.trim() || null : null,
        header_helper:
          transport === "streamable_http" && helperCommand.trim()
            ? {
                command: helperCommand.trim(),
                args: splitArgs(helperArgsText),
                cwd: helperCwd.trim() || null,
                env: mapFromRows(helperEnv),
                env_vars: splitArgs(helperEnvVarsText),
                timeout_ms: optionalMillis(helperTimeout),
              }
            : null,
        startup_timeout_ms: optionalMillis(startupTimeout),
        catalog_timeout_ms: optionalMillis(catalogTimeout),
        execution_timeout_ms: optionalMillis(executionTimeout),
        protocol,
      });
      if (!result.connected) {
        toast.error(`Test failed: ${result.error ?? "connection failed"}`);
        return;
      }
      setTools(result.tools);
      toast.success(
        `Connection succeeded: ${result.tools.length} tool${
          result.tools.length === 1 ? "" : "s"
        } found.`,
      );
    } catch (error) {
      toast.error(`Test failed: ${errorMessage(toRunError(commandError(error)))}`);
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
            disabled={operationBusy}
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
          disabled={operationBusy}
          onClick={() => void saveRef.current()}
        >
          Save
        </FooterButton>
      </>,
    );
    return () => setFooter(null);
  }, [isMobile, operationBusy, record, setFooter]);

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
              <FieldLabel
                label="Required"
                hint="Fail session admission when this enabled server cannot start."
              />
              <Switch
                checked={required}
                size={isMobile ? SwitchSize.Large : SwitchSize.Medium}
                onChange={setRequired}
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

          <div className="flex flex-col gap-1">
            <FieldLabel
              label="Protocol"
              hint={PROTOCOL_ITEMS.find((item) => item.id === protocol)?.hint}
            />
            <div className="flex flex-wrap gap-2">
              {PROTOCOL_ITEMS.map((item) => (
                <Button
                  key={item.id}
                  size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
                  variant={protocol === item.id ? ButtonVariant.Primary : ButtonVariant.Secondary}
                  content={ButtonContent.Text}
                  aria-pressed={protocol === item.id}
                  onClick={() => setProtocol(item.id)}
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
              <div className="flex flex-col gap-1">
                <FieldLabel
                  label="Bearer token environment variable"
                  hint="The variable value is sent as a Bearer token without persisting it."
                />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  placeholder="MCP_TOKEN"
                  value={bearerTokenEnvVar}
                  onChange={(event) => setBearerTokenEnvVar(event.target.value)}
                />
              </div>
              <KvEditor
                label="Environment-backed headers"
                hint="Map each HTTP header name to the environment variable that supplies its value."
                keyPlaceholder="X-API-Key"
                rows={envHeaders}
                onChange={setEnvHeaders}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel
                  label="Header helper command"
                  hint="Optional bounded command that prints a JSON object of same-origin request headers."
                />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  placeholder="./refresh-mcp-headers"
                  value={helperCommand}
                  onChange={(event) => setHelperCommand(event.target.value)}
                />
              </div>
              {helperCommand.trim() ? (
                <>
                  <div className="flex flex-col gap-1">
                    <FieldLabel label="Header helper arguments" hint="One argument per line." />
                    <TextArea
                      textAreaClassName="min-h-[64px] font-mono"
                      value={helperArgsText}
                      onChange={(event) => setHelperArgsText(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <FieldLabel label="Header helper working directory" />
                    <Input
                      inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                      value={helperCwd}
                      onChange={(event) => setHelperCwd(event.target.value)}
                    />
                  </div>
                  <KvEditor
                    label="Header helper environment"
                    hint="Stored literals remain write-only."
                    keyPlaceholder="TOKEN"
                    rows={helperEnv}
                    onChange={setHelperEnv}
                  />
                  <div className="flex flex-col gap-1">
                    <FieldLabel
                      label="Header helper forwarded environment"
                      hint="One variable name per line."
                    />
                    <TextArea
                      textAreaClassName="min-h-[64px] font-mono"
                      value={helperEnvVarsText}
                      onChange={(event) => setHelperEnvVarsText(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <FieldLabel label="Header helper timeout (ms)" />
                    <Input
                      inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                      type="number"
                      min={100}
                      max={600000}
                      value={helperTimeout}
                      onChange={(event) => setHelperTimeout(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
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
              <div className="flex flex-col gap-1">
                <FieldLabel
                  label="Working directory"
                  hint="Relative paths resolve from the workspace."
                />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  placeholder="packages/server"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel
                  label="Forward environment variables"
                  hint="One existing host variable name per line."
                />
                <TextArea
                  textAreaClassName="min-h-[64px] font-mono"
                  value={envVarsText}
                  onChange={(event) => setEnvVarsText(event.target.value)}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ["Startup timeout (ms)", startupTimeout, setStartupTimeout],
              ["Catalog timeout (ms)", catalogTimeout, setCatalogTimeout],
              ["Execution timeout (ms)", executionTimeout, setExecutionTimeout],
            ].map(([label, value, setter]) => (
              <div key={label as string} className="flex flex-col gap-1">
                <FieldLabel label={label as string} />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  type="number"
                  min={100}
                  max={600000}
                  value={value as string}
                  onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                />
              </div>
            ))}
          </div>

          {record ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-small text-basic-muted">
                Runtime: {runtime?.state ?? "disconnected"}
                {runtime?.error ? ` — ${runtime.error}` : ""}
              </span>
              {(["connect", "disconnect", "reload"] as const).map((action) => (
                <Button
                  key={action}
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Secondary}
                  disabled={operationBusy}
                  onClick={() => void operate(action)}
                >
                  {action[0].toUpperCase() + action.slice(1)}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2 justify-end">
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Secondary}
              disabled={operationBusy}
              onClick={() => void test()}
              content={ButtonContent.IconLeft}
            >
              <Icon iconName={IconName.Bolt} />
              {testingServer ? "Testing…" : "Test connection"}
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
