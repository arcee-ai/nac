import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Modal,
  ModalSize,
  type SelectItem,
  Separator,
  StickyButton,
  Switch,
  SwitchSize,
  TextArea,
} from "@/app/atoms";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { FormSection } from "@/app/components/modals/FormSection";
import { ConfigRow, FieldLabel } from "@/app/components/modals/ConfigRow";
import { type LaunchModelSelection } from "@/app/features/setup/modelSelection";
import { REASONING_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import { nullable, serializeExtraHeaders } from "@/app/lib/modelConfig";
import { toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";
import {
  createProjectChat,
  SetupFailure,
  requiresSetupReview,
} from "@/app/features/setup/workflow";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import {
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import {
  useCreateProject,
  useCreateSession,
  useModelCatalog,
  useSandboxActivity,
  useSandboxAvailability,
  useStoreInfo,
} from "@/app/services/queries";
import type { SshTarget } from "@/app/types/api";

import { projectChatRequest, type SandboxOptions } from "@/app/features/setup/projectLaunch";

type Mode = "local" | "ssh" | "sandbox";

const MODES: { id: Mode; label: string; description: string }[] = [
  {
    id: "local",
    label: "Local",
    description: "Runs on this machine with access to local files.",
  },
  {
    id: "ssh",
    label: "SSH",
    description: "Runs on a connected remote machine.",
  },
  {
    id: "sandbox",
    label: "Sandbox",
    description: "Runs in an isolated environment with limited access.",
  },
];

/** The configuration decides these, so "inherit" means "leave it alone". */
const ADVANCED_REASONING: SelectItem[] = REASONING_OPTIONS.map((item) =>
  item.id === "" ? { ...item, label: "From configuration" } : item,
);

// `.btn-medium.btn-icon-right` wins on specificity, so the inset that lines
// the path up with the neighbouring input has to be inline too.
const CWD_BUTTON_PADDING = { paddingInline: "8px" };

const EMPTY_SANDBOX: SandboxOptions = {
  noMount: false,
  image: "",
  gpu: "",
  workdir: "",
  shm: "",
  mounts: "",
};

/** `field` marks which control to flag; "config" flags the whole box. */
interface FormError {
  field: "cwd" | "ssh" | "config";
  message: string;
}

/** Remounted on every open so the form always starts from the configured defaults. */
export function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: storeInfo } = useStoreInfo();
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return (
    <CreateProjectForm
      // The exit transition briefly retains the form after close. Keying the
      // two phases guarantees a rapid reopen still gets fresh launch defaults.
      key={open ? "open" : "closing"}
      open={open}
      defaultCwd={storeInfo?.root_cwd ?? ""}
      onClose={onClose}
    />
  );
}

/**
 * A project is a location plus the defaults its chats inherit, so the form asks
 * for both and then opens the first chat: a project with nothing in it has
 * nothing to show.
 */
function CreateProjectForm({
  open,
  defaultCwd,
  onClose,
}: {
  open: boolean;
  defaultCwd: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const action = useSetupAction(open);
  const client = useQueryClient();
  const createProject = useCreateProject();
  const createSession = useCreateSession();

  const [mode, setMode] = useState<Mode>("local");
  const [cwd, setCwd] = useState(defaultCwd);
  const [name, setName] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [compaction, setCompaction] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [sandbox, setSandbox] = useState<SandboxOptions>(EMPTY_SANDBOX);
  const [headersOpen, setHeadersOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selection, setSelection] = useState<LaunchModelSelection | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [reviewError, setReviewError] = useState("");
  // The host this form has actually reached. Everything remote — the working
  // directory above all — is meaningless until one connection has answered, so
  // the rest of the form waits for it.
  const [connection, setConnection] = useState<SshTarget | null>(null);
  const compactionAutoRef = useRef(true);

  // The override only makes sense for the model the selection settles on, so
  // the catalog narrows it to the efforts that model accepts.
  const catalog = useModelCatalog();
  const chosen = selection;
  const reasoningItems = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, chosen?.backend, chosen?.model).supportedEfforts,
    reasoning,
    ADVANCED_REASONING,
  );

  const isMobile = useIsMobile();
  const isSsh = mode === "ssh";
  // Probed only while sandbox mode is selected, so a missing or stopped
  // podman runtime is flagged here instead of failing the launch.
  const sandboxAvailability = useSandboxAvailability(mode === "sandbox").data;
  const connected = isSsh ? connection : null;
  // A local or sandboxed session has nothing to connect to, so it is ready at once.
  const ready = !isSsh || connected !== null;
  const busy = action.busy;

  // A sandboxed launch can spend minutes pulling the image on first run;
  // the polled phase plus an elapsed timer is the difference between
  // "working" and "frozen". Each attempt gets a fresh launch id, sent with
  // the create request, so the poll only ever sees this launch's phase even
  // when another launch is in flight.
  const [launchKey, setLaunchKey] = useState<string | null>(null);
  const sandboxLaunching = createSession.isPending && mode === "sandbox";
  const sandboxActivity = useSandboxActivity(sandboxLaunching, launchKey).data;
  const activitySince = sandboxActivity?.since_epoch_ms;
  const [launchElapsed, setLaunchElapsed] = useState(0);
  useEffect(() => {
    if (!sandboxLaunching) return;
    const timer = setInterval(() => {
      setLaunchElapsed(
        activitySince ? Math.max(0, Math.floor((Date.now() - activitySince) / 1000)) : 0,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [sandboxLaunching, activitySince]);

  // Any edit clears the previous attempt's error, which also re-enables submit.
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setError(null);
      setter(value);
    };
  const setSb = (patch: Partial<SandboxOptions>) => {
    setError(null);
    setSandbox((current) => ({ ...current, ...patch }));
  };

  const onSelection = useCallback((next: LaunchModelSelection | null) => {
    setSelection(next);
    setError((current) => (current?.field === "config" ? null : current));
  }, []);

  // Auto-suggest 70% of the selected model's effective input budget as the compaction
  // threshold. A manually entered value is preserved across model changes —
  // the suggestion only fills the field when it is empty or was itself last
  // auto-suggested.
  const compactionPlaceholder = useMemo(() => {
    const resolved = resolveCatalogModel(catalog.data, chosen?.backend, chosen?.model);
    const threshold = resolved.automaticThreshold;
    return threshold != null ? String(threshold) : "auto";
  }, [catalog.data, chosen?.backend, chosen?.model]);
  useEffect(() => {
    if (compactionPlaceholder !== "auto" && compactionAutoRef.current) {
      compactionAutoRef.current = true;
      setCompaction(compactionPlaceholder);
    }
  }, [compactionPlaceholder, selection]);

  const onCompactionChange = (value: string) => {
    setError(null);
    compactionAutoRef.current = false;
    setCompaction(value);
  };

  /** Paths belong to whichever machine runs the project, so they do not carry over. */
  const changeMode = (next: Mode) => {
    if (next === mode) return;
    setError(null);
    setMode(next);
    setPicking(false);
    setConnection(null);
    setCwd(next === "ssh" ? "" : defaultCwd);
  };

  /**
   * The SSH box owns Connect/Disconnect; we only keep the proved target and
   * seed the working directory from the login home it returned.
   */
  const onSshConnectionChange = (target: SshTarget | null, homePath?: string) => {
    setError(null);
    setConnection(target);
    if (target) {
      if (homePath) setCwd(homePath);
    } else {
      setCwd("");
    }
  };

  const submit = async () => {
    if (action.needsReview || busy) return;
    if (isSsh && !connected) {
      setError({
        field: "ssh",
        message: "Connect to the SSH host before creating a project.",
      });
      return;
    }
    if (!nullable(cwd)) {
      setError({ field: "cwd", message: "A working folder is required." });
      return;
    }
    if (!selection) {
      setError({
        field: "config",
        message: "Complete the provider configuration before creating a project.",
      });
      return;
    }

    let headers: Record<string, string> | undefined;
    try {
      headers = serializeExtraHeaders(extraHeaders, undefined);
    } catch (validationError) {
      setError({ field: "config", message: errorMessage(toRunError(validationError)) });
      return;
    }

    let createdProjectId: string | null = null;
    try {
      const result = await action.run((current) =>
        createProjectChat({
          current: current.current,
          classify: classifySetupFailure,
          reconcile: setupReconciliation(client),
          persistsModel: false,
          model: async () => selection,
          project: async () => {
            const project = await createProject.mutateAsync({
              name: nullable(name),
              cwd,
              ssh_host: connected?.ssh_host ?? null,
              ssh_port: connected?.ssh_port ?? null,
              ssh_identity_file: connected?.ssh_identity_file ?? null,
            });
            createdProjectId = project.project_id;
            return project;
          },
          chat: async (selected, project) => {
            const activityKey = mode === "sandbox" ? crypto.randomUUID() : null;
            if (current.current()) setLaunchKey(activityKey);
            const body = projectChatRequest({
              selected,
              projectId: project.project_id,
              reasoning,
              headers,
              compaction,
              automaticCompaction: compactionAutoRef.current,
              execution: connected ? "ssh" : mode,
              sandbox,
              activityKey,
            });
            const snapshot = await createSession.mutateAsync(body);
            return { snapshot };
          },
        }),
      );
      if (!result) return;
      const { snapshot } = result.chat;
      toast.success("Project created");
      navigate(
        snapshot.metadata.session_id
          ? routes.session(snapshot.metadata.session_id)
          : routes.project(result.project.project_id),
      );
      onClose();
    } catch (createError) {
      if (
        createdProjectId &&
        createError instanceof SetupFailure &&
        createError.kind !== "unknown"
      ) {
        toast.error(
          `Project created, but the first chat failed: ${setupFailureMessage(createError)}`,
        );
        navigate(routes.project(createdProjectId));
        onClose();
      } else {
        const message = setupFailureMessage(createError);
        if (requiresSetupReview(createError)) setReviewError(message);
        setError({
          field:
            createError instanceof SetupFailure &&
            createError.phase === "project" &&
            createError.kind === "rejected"
              ? "cwd"
              : "config",
          message,
        });
      }
    }
  };

  const invalid = (field: FormError["field"]) => error?.field === field;

  const smallSelect = (
    items: SelectItem[],
    value: string,
    onValueChange: (id: string) => void,
    disabled = false,
  ) => (
    <SmallSelect
      presentation="form"
      items={items}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Project"
      size={ModalSize.Wide}
      flush
      className="h-[680px] max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11"
      footer={
        isMobile ? (
          <StickyButton
            buttonClassName="min-h-11 min-w-11 max-w-full"
            className="min-h-11 max-w-full"
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
            disabled={busy || action.needsReview || Boolean(error) || !selection || !ready}
          >
            Create Project
          </StickyButton>
        ) : (
          <Button
            variant={ButtonVariant.Primary}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
            disabled={busy || action.needsReview || Boolean(error) || !selection || !ready}
          >
            Create Project
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-8 [&>*]:shrink-0">
        <p className="text-small !leading-[22px] text-basic-secondary">
          Choose where NAC works and the model for your first chat.
        </p>

        <FormSection title="Environment" description="Where NAC runs commands and accesses files.">
          <div className="flex flex-wrap items-start gap-2">
            {MODES.map((item) => (
              <Button
                key={item.id}
                variant={
                  mode === item.id ? ButtonVariant.SecondaryHighlighted : ButtonVariant.Secondary
                }
                size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
                content={ButtonContent.Text}
                onClick={() => changeMode(item.id)}
                aria-pressed={mode === item.id}
                className="flex-1 md:flex-none"
              >
                {item.label}
              </Button>
            ))}
          </div>
          {/* What the chosen environment means for the project, which the three
              one-word buttons cannot say on their own. */}
          <p className="text-small !leading-[22px] text-basic-secondary">
            {MODES.find((item) => item.id === mode)?.description}
          </p>
          {mode === "sandbox" && sandboxAvailability && sandboxAvailability.status !== "ready" ? (
            <div className="pt-1">
              <p className="text-error-primary text-micro">
                {sandboxAvailability.status === "missing"
                  ? "Sandbox mode runs sessions in a podman container, and podman is not installed on this machine."
                  : `Sandbox mode needs podman, which is not responding${sandboxAvailability.detail ? `: ${sandboxAvailability.detail}` : "."}`}
              </p>
              {sandboxAvailability.guidance ? (
                <pre className="pt-1 whitespace-pre-wrap font-mono text-micro text-basic-muted">
                  {sandboxAvailability.guidance}
                </pre>
              ) : null}
            </div>
          ) : null}
        </FormSection>

        {isSsh ? (
          <SshConnectionBox
            mode="launch"
            connection={connection}
            onConnectionChange={onSshConnectionChange}
          />
        ) : null}

        {ready ? (
          <FormSection
            title="Project location"
            description={
              isSsh
                ? "Choose a folder on the connected SSH host. Your files stay on that host."
                : "Choose an existing local or Git working folder on the NAC server."
            }
          >
            <div className="flex flex-col md:flex-row items-start gap-4">
              <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
                <FieldLabel label="Working Folder" required invalid={invalid("cwd")} />
                <Button
                  variant={ButtonVariant.Secondary}
                  size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
                  content={ButtonContent.IconRight}
                  aria-label={cwd ? `Choose Working Folder: ${cwd}` : "Choose Working Folder"}
                  className={cn("w-full", invalid("cwd") && "input-validation")}
                  style={CWD_BUTTON_PADDING}
                  onClick={() => setPicking(true)}
                >
                  <span
                    className={cn(
                      "flex-1 min-w-0 truncate text-left font-normal",
                      cwd ? "text-basic-primary" : "text-basic-muted",
                    )}
                  >
                    {cwd || "/path/to/project"}
                  </span>
                  <Icon iconName={IconName.Folder} className="shrink-0" />
                </Button>
                {invalid("cwd") ? (
                  <p role="alert" className="pt-1 text-error-primary text-small !leading-[22px]">
                    {error?.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
                <Input
                  label={<span className="label-small">Project name</span>}
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  placeholder="Taken from the git remote"
                  value={name}
                  onChange={(e) => edit(setName)(e.target.value)}
                  className={`${isMobile ? "w-full" : ""}`}
                />
              </div>
            </div>
          </FormSection>
        ) : null}

        {ready ? (
          <ModelSetupSection
            invalid={invalid("config")}
            errorText={reviewError || (invalid("config") ? error?.message : undefined)}
            onChange={onSelection}
          >
            <div className="flex flex-col gap-2">
              <Separator />
              <ConfigRow
                presentation="form"
                label="Reasoning Effort"
                hint="Higher effort for deeper reasoning and lower effort for faster responses."
                control={smallSelect(reasoningItems, reasoning, edit(setReasoning))}
              />
              <Separator />
              <ConfigRow
                presentation="form"
                label="Context Limit"
                hint="Context size that triggers compaction. Defaults to 70% of the model's effective input budget, subject to provider limits."
                control={
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Context Limit"
                      inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                      className="w-full md:w-[120px]"
                      inputClassName="md:text-right"
                      placeholder={compactionPlaceholder}
                      inputMode="numeric"
                      value={compaction}
                      onChange={(e) => onCompactionChange(e.target.value)}
                    />
                    <span className="shrink-0 text-micro text-basic-muted">tokens</span>
                  </div>
                }
              />
              {mode === "sandbox" ? (
                <>
                  <Separator />
                  <ConfigRow
                    presentation="form"
                    label="Sandbox options"
                    hint="The container the session runs in: image, GPUs, workdir, shared memory and mounts."
                    control={
                      <Switch
                        className="max-md:before:absolute max-md:before:-inset-4"
                        checked={sandboxOpen}
                        onChange={setSandboxOpen}
                        aria-label="Sandbox options"
                      />
                    }
                  />
                  {sandboxOpen ? (
                    <>
                      <Separator />
                      <ConfigRow
                        presentation="form"
                        label="Container image"
                        hint="Image the sandbox runs; empty uses the configured default."
                        control={
                          <Input
                            aria-label="Container image"
                            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                            className="w-full md:w-[280px]"
                            placeholder="python:3.13-bookworm"
                            value={sandbox.image}
                            onChange={(e) => setSb({ image: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        presentation="form"
                        label="GPUs"
                        hint="Comma-separated GPU list, e.g. all."
                        control={
                          <Input
                            aria-label="GPUs"
                            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                            className="w-full md:w-[280px]"
                            placeholder="all"
                            value={sandbox.gpu}
                            onChange={(e) => setSb({ gpu: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        presentation="form"
                        label="Container workdir"
                        hint="Working directory inside the container."
                        control={
                          <Input
                            aria-label="Container workdir"
                            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                            className="w-full md:w-[280px]"
                            placeholder="/workspace"
                            value={sandbox.workdir}
                            onChange={(e) => setSb({ workdir: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        presentation="form"
                        label="Shared memory size"
                        hint="Container /dev/shm size, e.g. 1g."
                        control={
                          <Input
                            aria-label="Shared memory size"
                            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                            className="w-full md:w-[280px]"
                            placeholder="0"
                            value={sandbox.shm}
                            onChange={(e) => setSb({ shm: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        presentation="form"
                        label="Mounts (HOST:GUEST)"
                        hint="Comma-separated bind mounts."
                        control={
                          <Input
                            aria-label="Mounts (HOST:GUEST)"
                            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                            className="w-full md:w-[280px]"
                            placeholder="/data:/data"
                            value={sandbox.mounts}
                            onChange={(e) => setSb({ mounts: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        presentation="form"
                        label="Don't mount the working folder"
                        secondary
                        control={
                          <Switch
                            className="max-md:before:absolute max-md:before:-inset-4"
                            checked={sandbox.noMount}
                            onChange={(value) => setSb({ noMount: value })}
                            aria-label="Don't mount the working folder"
                            size={isMobile ? SwitchSize.Large : SwitchSize.Medium}
                          />
                        }
                      />
                    </>
                  ) : null}
                </>
              ) : null}

              <Separator />
              <ConfigRow
                presentation="form"
                label="Custom HTTP headers"
                hint="Turn this on only if you need to send additional request metadata."
                control={
                  <Switch
                    className="max-md:before:absolute max-md:before:-inset-4"
                    checked={headersOpen}
                    onChange={setHeadersOpen}
                    aria-label="Custom HTTP headers"
                  />
                }
              />
              {headersOpen ? (
                <>
                  <Separator />
                  <TextArea
                    label="Extra headers (JSON object)"
                    hintText="Blank keeps the configuration's headers. Enter {} to send none; header values must be strings."
                    placeholder='{"X-Title": "NAC"}'
                    value={extraHeaders}
                    onChange={(e) => edit(setExtraHeaders)(e.target.value)}
                    textAreaClassName="h-[108px] resize-none"
                  />
                </>
              ) : null}
            </div>
          </ModelSetupSection>
        ) : null}

        {sandboxLaunching ? (
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <span className="text-micro text-basic-primary">
              {sandboxActivity?.phase ?? "Creating the sandbox…"}
            </span>
            <span className="text-micro text-basic-muted">{launchElapsed}s</span>
          </div>
        ) : null}
      </div>

      <PathPickerModal
        open={picking}
        kind="directory"
        nativeLocalDirectory={mode === "local"}
        initialPath={cwd}
        ssh={connected}
        onClose={() => setPicking(false)}
        onSelect={(path) => {
          edit(setCwd)(path);
          setPicking(false);
        }}
      />
    </Modal>
  );
}
