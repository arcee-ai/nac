import { useState, type ReactNode } from "react";

import {
  Icon,
  IconName,
  Input,
  InputSize,
  Popover,
  PopoverPlacement,
  PopoverSize,
  Switch,
  Tooltip,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import type { SandboxAvailability } from "@/app/types/api";
import { EMPTY_SANDBOX, type SandboxOptions } from "./workspaceSandbox";

/**
 * The composer strip's "⋯" button: whether the session gets an isolated
 * checkout or a Podman sandbox. Each option preserves the ordinary composer
 * and exposes the launch details only when selected.
 */
export function WorkspaceSettings({
  isolated,
  available,
  onIsolatedChange,
  gitRef,
  defaultRef,
  onRefChange,
  sandbox,
  disabled,
}: {
  isolated: boolean;
  available: boolean;
  onIsolatedChange: (isolated: boolean) => void;
  gitRef: string;
  defaultRef: string | null;
  onRefChange: (ref: string) => void;
  sandbox?: {
    allowed: boolean;
    options: SandboxOptions | null;
    availability?: SandboxAvailability;
    checking: boolean;
    checkFailed: boolean;
    onChange: (options: SandboxOptions | null) => void;
    onRetry: () => void;
  };
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "ref" | "sandbox">("main");
  const [draft, setDraft] = useState(gitRef);
  const startRef = gitRef || defaultRef;
  const sandboxSelected = Boolean(sandbox?.options);
  const close = () => {
    setOpen(false);
    setView("main");
  };
  const applyRef = (ref: string) => {
    onRefChange(ref);
    setView("main");
  };

  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      focusScope="Additional settings"
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Medium}
      content={
        view === "main" || (view === "sandbox" && (!sandbox?.options || !sandbox.allowed)) ? (
          <>
            <p className="type-meta px-2.5 pt-1.5 pb-1 text-basic-tertiary">Additional settings</p>
            <SettingRow icon={IconName.FolderCopy} label="Isolated checkout">
              <Switch
                aria-label="Isolated checkout"
                checked={isolated}
                disabled={disabled || (!available && !isolated)}
                onChange={onIsolatedChange}
              />
            </SettingRow>
            {available ? null : (
              <p className="type-meta px-2.5 pb-1.5 text-basic-tertiary">
                Needs a direct agent in a local Git project.
              </p>
            )}
            <button
              type="button"
              disabled={disabled || !isolated || !available}
              onClick={() => {
                setDraft(gitRef);
                setView("ref");
              }}
              className={cn(
                "flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-basic-primary outline-none max-md:min-h-11",
                "hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <Icon iconName={IconName.Scheme} size={14} className="shrink-0 text-basic-tertiary" />
              <span className="flex-1">Start from</span>
              <span className="min-w-0 truncate text-basic-tertiary">
                {startRef ?? "Choose a ref"}
              </span>
              <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
            </button>
            {sandbox ? (
              <>
                <SettingRow icon={IconName.Private} label="Sandbox">
                  <Switch
                    aria-label="Sandbox"
                    checked={sandboxSelected}
                    disabled={disabled || (!sandbox.allowed && !sandboxSelected)}
                    onChange={(selected) => sandbox.onChange(selected ? EMPTY_SANDBOX : null)}
                  />
                </SettingRow>
                {sandboxSelected ? (
                  <>
                    <SandboxStatus
                      availability={sandbox.availability}
                      checking={sandbox.checking}
                      failed={sandbox.checkFailed}
                      allowed={sandbox.allowed}
                      onRetry={sandbox.onRetry}
                    />
                    <button
                      type="button"
                      disabled={disabled || !sandbox.allowed}
                      onClick={() => setView("sandbox")}
                      className="flex min-h-8 items-center gap-2 rounded-lg px-2.5 text-left text-basic-primary outline-none hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] disabled:opacity-50 max-md:min-h-11"
                    >
                      <Icon
                        iconName={IconName.Controls}
                        size={14}
                        className="shrink-0 text-basic-tertiary"
                      />
                      <span className="flex-1">Sandbox options</span>
                      <Icon
                        iconName={IconName.Right}
                        size={12}
                        className="shrink-0 text-basic-muted"
                      />
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : view === "sandbox" && sandbox?.options && sandbox.allowed ? (
          <>
            <SettingsBack label="Sandbox options" onBack={() => setView("main")} />
            <SandboxFields
              options={sandbox.options}
              onChange={sandbox.onChange}
              disabled={disabled}
            />
          </>
        ) : (
          <>
            <SettingsBack label="Start from" onBack={() => setView("main")} />
            <div className="px-1 pb-1">
              <input
                autoFocus
                aria-label="Branch, tag or commit"
                placeholder={defaultRef ?? "Branch, tag or commit"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  applyRef(draft.trim());
                }}
                className="type-body-chrome h-8 w-full rounded-lg border border-tertiary bg-elevation-level-1 px-2.5 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary max-md:h-11 max-md:text-base"
              />
            </div>
            {defaultRef ? (
              <button
                type="button"
                onClick={() => applyRef("")}
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-basic-primary outline-none hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] max-md:min-h-11"
              >
                <span className="flex-1">Default branch ({defaultRef})</span>
                {gitRef ? null : (
                  <Icon iconName={IconName.Check} size={14} className="text-basic-secondary" />
                )}
              </button>
            ) : (
              <p className="type-meta px-2.5 py-1.5 text-basic-tertiary">
                This project has no saved default branch yet; you can save one when the task starts.
              </p>
            )}
          </>
        )
      }
    >
      <Tooltip
        title={
          sandboxSelected
            ? "Sandbox"
            : isolated
              ? `Isolated checkout from ${startRef ?? "…"}`
              : "Additional settings"
        }
        disabled={open}
      >
        <button
          type="button"
          aria-label="Additional settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? close() : setOpen(true))}
          className={cn(
            "type-label inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-pill px-1.5 text-basic-secondary outline-none max-md:h-11 max-md:min-w-11",
            "hover:bg-[var(--f-wash-2)] hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] disabled:opacity-50",
            (open || isolated || sandboxSelected) && "bg-[var(--f-wash-2)] text-basic-primary",
          )}
        >
          {sandboxSelected ? (
            <span className="flex items-center gap-1 pl-1">
              <Icon iconName={IconName.Private} size={14} />
              Sandbox
            </span>
          ) : isolated ? (
            <span className="flex min-w-0 items-center gap-1 pl-1">
              <Icon iconName={IconName.FolderCopy} size={14} className="shrink-0" />
              <span className="max-w-40 truncate">{startRef ?? "Isolated"}</span>
            </span>
          ) : null}
          <Icon iconName={IconName.MenuHorizontal} size={16} className="shrink-0" />
        </button>
      </Tooltip>
    </Popover>
  );
}

function SettingsBack({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1 pt-0.5 pb-1">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="flex size-6 items-center justify-center rounded-md text-basic-secondary outline-none hover:bg-[var(--f-wash-1)] focus-visible:bg-[var(--f-wash-1)] max-md:size-11"
      >
        <Icon iconName={IconName.Left} size={14} />
      </button>
      <span className="type-meta text-basic-tertiary">{label}</span>
    </div>
  );
}

function SandboxStatus({
  availability,
  checking,
  failed,
  allowed,
  onRetry,
}: {
  availability?: SandboxAvailability;
  checking: boolean;
  failed: boolean;
  allowed: boolean;
  onRetry: () => void;
}) {
  if (!allowed) {
    return (
      <p className="type-meta px-2.5 text-error-primary">
        Sandbox needs an unmanaged local project.
      </p>
    );
  }
  if (checking)
    return (
      <p role="status" className="type-meta px-2.5">
        Checking Podman…
      </p>
    );
  const error = failed
    ? "Could not check whether Podman is ready."
    : availability?.status === "missing"
      ? "Podman is not installed on this machine."
      : availability?.status === "unavailable"
        ? availability.detail || "Podman is not responding."
        : null;
  if (!error) {
    return (
      <p className="type-meta px-2.5 text-basic-tertiary">
        Run this session in a Podman container.
      </p>
    );
  }
  return (
    <div className="type-meta px-2.5">
      <p role="status" className="text-error-primary">
        {error}
      </p>
      {availability?.guidance ? (
        <pre className="mt-1 whitespace-pre-wrap text-basic-secondary">{availability.guidance}</pre>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="min-h-8 rounded-md text-basic-primary underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] max-md:min-h-11"
      >
        Check Podman again
      </button>
    </div>
  );
}

const SANDBOX_FIELDS = [
  ["image", "Container image", "Use the configured image"],
  ["workdir", "Container workdir", "Use the mounted workspace directory"],
  ["gpu", "GPU devices", "Comma-separated device names"],
  ["shm", "Shared memory size", "Use the default"],
  ["mounts", "Additional mounts", "Comma-separated host:container paths"],
] as const;

function SandboxFields({
  options,
  onChange,
  disabled,
}: {
  options: SandboxOptions;
  onChange: (options: SandboxOptions) => void;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();
  return (
    <div className="flex max-h-[55dvh] flex-col gap-2 overflow-y-auto px-2 pb-2">
      {SANDBOX_FIELDS.map(([key, label, placeholder]) => (
        <Input
          key={key}
          label={label}
          aria-label={label}
          inputSize={isMobile ? InputSize.Large : InputSize.Medium}
          placeholder={placeholder}
          value={options[key]}
          onChange={(event) => onChange({ ...options, [key]: event.target.value })}
          isDisabled={disabled}
        />
      ))}
      <SettingRow icon={IconName.FolderCopy} label="Don’t mount the working folder">
        <Switch
          aria-label="Don’t mount the working folder"
          checked={options.noMount}
          onChange={(noMount) => onChange({ ...options, noMount })}
          disabled={disabled}
        />
      </SettingRow>
    </div>
  );
}

function SettingRow({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-2.5 text-basic-primary max-md:min-h-11">
      <Icon iconName={icon} size={14} className="shrink-0 text-basic-tertiary" />
      <span className="flex-1">{label}</span>
      {children}
    </div>
  );
}
