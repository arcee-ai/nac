import { useRef, useState } from "react";
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
  StickyButton,
} from "@/app/atoms";
import { FormSection } from "@/app/components/modals/FormSection";
import { FieldLabel } from "@/app/components/modals/ConfigRow";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { classifySetupFailure } from "@/app/features/setup/browserAdapters";
import { useSetupLifetime } from "@/app/features/setup/lifetime";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { nullable } from "@/app/lib/modelConfig";
import { toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useCreateProject, useStoreInfo } from "@/app/services/queries";
import type { SshTarget } from "@/app/types/api";

type Mode = "local" | "ssh";

const MODES: { id: Mode; label: string; description: string }[] = [
  {
    id: "local",
    label: "Local",
    description: "A folder on this machine.",
  },
  {
    id: "ssh",
    label: "SSH",
    description: "A folder on a connected remote machine. Your files stay on that host.",
  },
];

// `.btn-medium.btn-icon-right` wins on specificity, so the inset that lines
// the path up with the neighbouring input has to be inline too.
const CWD_BUTTON_PADDING = { paddingInline: "8px" };

/** Remounted on every open so the form always starts from the configured defaults. */
export function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: storeInfo } = useStoreInfo();
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return (
    <CreateProjectForm
      // The exit transition briefly retains the form after close. Keying the
      // two phases guarantees a rapid reopen still gets fresh defaults.
      key={open ? "open" : "closing"}
      open={open}
      defaultCwd={storeInfo?.root_cwd ?? ""}
      onClose={onClose}
    />
  );
}

/**
 * A project is a location: a folder, locally or on an SSH host, and a name.
 * Model, effort and environment belong to each session, chosen in the
 * composer this opens onto.
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
  const createProject = useCreateProject();
  const lifetime = useSetupLifetime(open);
  const isMobile = useIsMobile();

  const [mode, setMode] = useState<Mode>("local");
  const [cwd, setCwd] = useState(defaultCwd);
  const [name, setName] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  // The host this form has actually reached. A remote folder is meaningless
  // until one connection has answered, so the location waits for it.
  const [connection, setConnection] = useState<SshTarget | null>(null);

  const isSsh = mode === "ssh";
  const connected = isSsh ? connection : null;
  const ready = !isSsh || connected !== null;
  const busy = createProject.isPending;
  // A second click can land before the pending state renders.
  const submitting = useRef(false);
  const visibleError = reviewRequired
    ? "Could not confirm whether the project was created. Close this dialog and check Projects before trying again."
    : error;
  const close = () => {
    lifetime.current?.close();
    onClose();
  };

  /** Paths belong to whichever machine holds the project, so they do not carry over. */
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
   * seed the folder from the login home it returned.
   */
  const onSshConnectionChange = (target: SshTarget | null, homePath?: string) => {
    setError(null);
    setConnection(target);
    setCwd(target ? (homePath ?? "") : "");
  };

  const submit = async () => {
    const lease = lifetime.current;
    if (!lease?.current() || submitting.current || !ready || reviewRequired) return;
    if (!nullable(cwd)) {
      setError("A working folder is required.");
      return;
    }
    submitting.current = true;
    try {
      const project = await createProject.mutateAsync({
        name: nullable(name),
        cwd,
        ssh_host: connected?.ssh_host ?? null,
        ssh_port: connected?.ssh_port ?? null,
        ssh_identity_file: connected?.ssh_identity_file ?? null,
      });
      if (!lease.current()) return;
      toast.success("Project created");
      navigate(routes.newSession(project.project_id));
      close();
    } catch (createError) {
      if (!lease.current()) return;
      if (classifySetupFailure(createError, "project") === "unknown") {
        setReviewRequired(true);
        return;
      }
      setError(errorMessage(toRunError(createError)));
    } finally {
      submitting.current = false;
    }
  };

  const disabled = busy || Boolean(visibleError) || !ready;

  return (
    <Modal
      open={open}
      onClose={close}
      title="New Project"
      size={ModalSize.Medium}
      flush
      className="max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11"
      footer={
        isMobile ? (
          <StickyButton
            buttonClassName="min-h-11 min-w-11 max-w-full"
            className="min-h-11 max-w-full"
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
            disabled={disabled}
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
            disabled={disabled}
          >
            Create Project
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-8 [&>*]:shrink-0">
        <FormSection title="Location" description="Where the project's files live.">
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
                disabled={busy}
                aria-pressed={mode === item.id}
                className="flex-1 md:flex-none"
              >
                {item.label}
              </Button>
            ))}
          </div>
          <p className="text-small !leading-[22px] text-basic-secondary">
            {MODES.find((item) => item.id === mode)?.description}
          </p>
        </FormSection>

        {isSsh ? (
          <SshConnectionBox
            mode="launch"
            connection={connection}
            onConnectionChange={onSshConnectionChange}
          />
        ) : null}

        {ready ? (
          <div className="flex flex-col md:flex-row items-start gap-4">
            <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
              <FieldLabel label="Working Folder" required invalid={Boolean(visibleError)} />
              <Button
                variant={ButtonVariant.Secondary}
                size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
                content={ButtonContent.IconRight}
                aria-label={cwd ? `Choose Working Folder: ${cwd}` : "Choose Working Folder"}
                className={cn("w-full", visibleError && "input-validation")}
                style={CWD_BUTTON_PADDING}
                onClick={() => setPicking(true)}
                disabled={busy}
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
              {visibleError ? (
                <p role="alert" className="pt-1 text-error-primary text-small !leading-[22px]">
                  {visibleError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
              <Input
                label={<span className="label-small">Project name</span>}
                inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                placeholder="Taken from the git remote"
                value={name}
                disabled={busy}
                onChange={(e) => {
                  setError(null);
                  setName(e.target.value);
                }}
                className={isMobile ? "w-full" : ""}
              />
            </div>
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
          setError(null);
          setCwd(path);
          setPicking(false);
        }}
      />
    </Modal>
  );
}
