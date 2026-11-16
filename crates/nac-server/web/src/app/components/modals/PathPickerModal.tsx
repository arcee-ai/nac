import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
  Modal,
  ModalSize,
  StickyButton,
} from "@/app/atoms";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { cn } from "@/app/lib/cn";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useBrowsePath, useSshBrowsePath, type BrowseKind } from "@/app/services/queries";
import type { SshTarget } from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { localDirectoryCapability } from "@/app/features/setup/localFolder";
import { NativeFolderPicker } from "@/app/features/setup/NativeFolderPicker";

/**
 * Picks a path from the machine running the server, or from an SSH host when
 * `ssh` names one.
 *
 * Browsers never hand a web page an absolute path — `<input type="file">` and
 * the File System Access API both withhold it — so the filesystem is browsed
 * through the API instead of through the operating system's dialog. A remote
 * host is browsed the same way for the same reason, one directory per request.
 */
interface PathPickerProps {
  kind: BrowseKind;
  initialPath: string;
  /** Explicit opt-in from the normal create-project Local backend only. */
  nativeLocalDirectory?: boolean;
  /** Browses this host instead of the local filesystem. */
  ssh?: SshTarget | null;
  /** Overrides the title derived from `kind`. */
  title?: string;
  /** Starts with dot-prefixed entries listed, for paths that live in one. */
  showHidden?: boolean;
  /** Offers a way back to whatever the caller treats as no explicit path. */
  clearLabel?: string;
  onClear?: () => void;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function PathPickerModal({
  open,
  ssh,
  nativeLocalDirectory = false,
  ...props
}: PathPickerProps & { open: boolean }) {
  const mounted = useExitTransition(open);
  const { nativeDirectory } = useNativeRuntime();
  const port = localDirectoryCapability(nativeDirectory, nativeLocalDirectory, props.kind, ssh);
  if (!mounted) return null;
  if (port)
    return (
      <NativeFolderPicker
        port={port}
        open={open}
        initialPath={props.initialPath}
        onSelect={props.onSelect}
        onClose={props.onClose}
      />
    );
  return <PathPicker open={open} ssh={ssh ?? null} {...props} />;
}

function PathPicker({
  open,
  kind,
  initialPath,
  ssh,
  title,
  showHidden = false,
  clearLabel,
  onClear,
  onClose,
  onSelect,
}: PathPickerProps & { open: boolean }) {
  const pickingFile = kind !== "directory";
  const isMobile = useIsMobile();
  // A directory is picked from an empty path so the server starts at its root,
  // or the host at the login home.
  // A nonblank local path identifies a literal filesystem entry. Preserve its
  // whitespace; blank input still requests the fallback. SSH keeps its existing
  // normalization contract.
  const browsePath = (path: string) => (ssh || !path.trim() ? path.trim() : path);
  const [directory, setDirectory] = useState(browsePath(initialPath));
  const [draft, setDraft] = useState(browsePath(initialPath));
  const [file, setFile] = useState<string | null>(null);
  const [hidden, setHidden] = useState(showHidden);
  // Both hooks are called every render, as hooks must be; the one that is not
  // the source of this listing is disabled and never fetches.
  const local = useBrowsePath(directory || null, kind, hidden, !ssh);
  const remote = useSshBrowsePath(ssh ?? null, directory || null, hidden, Boolean(ssh));
  const { data, error, isFetching } = ssh ? remote : local;

  const goTo = (path: string) => {
    setDirectory(path);
    setDraft(path);
    setFile(null);
  };

  const chosen = pickingFile ? file : (data?.path ?? directory);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        title ??
        (kind === "toml"
          ? "Select Config File"
          : kind === "file"
            ? "Select File"
            : ssh
              ? `Select Working Folder on ${ssh.ssh_host}`
              : "Select Working Folder")
      }
      size={ModalSize.Wide}
      flush
      className="h-[560px] max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11"
      bodyClassName={cn("min-h-0", onClear && "max-md:pb-32")}
      footer={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 md:contents">
          {onClear ? (
            isMobile ? (
              <StickyButton
                buttonClassName="min-h-11 min-w-11 max-w-full"
                className="min-h-11 max-w-full"
                variant={ButtonVariant.Secondary}
                content={ButtonContent.Text}
                onClick={onClear}
              >
                <span className="min-w-0 truncate">{clearLabel ?? "Clear"}</span>
              </StickyButton>
            ) : (
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Large}
                content={ButtonContent.Text}
                className="mr-auto"
                onClick={onClear}
              >
                <span className="min-w-0 truncate">{clearLabel ?? "Clear"}</span>
              </Button>
            )
          ) : null}
          {isMobile ? (
            <StickyButton
              buttonClassName="min-h-11 min-w-11 max-w-full"
              className="min-h-11 max-w-full"
              variant={ButtonVariant.Secondary}
              content={ButtonContent.Text}
              onClick={onClose}
            >
              Cancel
            </StickyButton>
          ) : (
            <Button
              variant={ButtonVariant.Secondary}
              size={ButtonSize.Large}
              content={ButtonContent.Text}
              onClick={onClose}
            >
              Cancel
            </Button>
          )}

          {isMobile ? (
            <StickyButton
              buttonClassName="min-h-11 min-w-11 max-w-full"
              className="min-h-11 max-w-full"
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              disabled={!chosen}
              onClick={() => {
                if (chosen) onSelect(chosen);
              }}
            >
              Select
            </StickyButton>
          ) : (
            <Button
              variant={ButtonVariant.Primary}
              size={ButtonSize.Large}
              content={ButtonContent.Text}
              disabled={!chosen}
              onClick={() => {
                if (chosen) onSelect(chosen);
              }}
            >
              Select
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3 h-full min-h-0">
        <p className="shrink-0 text-small !leading-[22px] text-basic-secondary">
          {ssh
            ? "Browse folders on the connected SSH host."
            : "Browse files on the NAC server, including existing Git working folders."}
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant={ButtonVariant.Secondary}
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            content={ButtonContent.Icon}
            disabled={!data?.parent}
            onClick={() => data?.parent && goTo(data.parent)}
            aria-label="Parent directory"
          >
            <Icon iconName={IconName.Top} />
          </Button>
          <Button
            variant={ButtonVariant.Secondary}
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            content={ButtonContent.Icon}
            disabled={!data?.home}
            onClick={() => data?.home && goTo(data.home)}
            aria-label="Home directory"
          >
            <Icon iconName={IconName.Home} />
          </Button>
          <Input
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1"
            aria-label="Folder path"
            placeholder={ssh ? "~/path/on/the/host" : "/path/to/directory"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) goTo(browsePath(draft));
            }}
          />
          <Button
            variant={hidden ? ButtonVariant.SecondaryHighlighted : ButtonVariant.Secondary}
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            content={ButtonContent.Icon}
            onClick={() => setHidden((on) => !on)}
            aria-pressed={hidden}
            title={hidden ? "Hide dot-prefixed entries" : "Show hidden entries"}
            aria-label={hidden ? "Hide dot-prefixed entries" : "Show hidden entries"}
          >
            <Icon iconName={hidden ? IconName.Eye : IconName.EyeStrikethrough} />
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-small !leading-[22px] text-error-primary shrink-0">
            {errorMessage(error)}
          </p>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto rounded-[8px] border border-muted p-1 flex flex-col [&>*]:shrink-0">
          {isFetching && !data ? (
            <div className="flex items-center justify-center py-6">
              <Loader size={LoaderSize.Small} />
            </div>
          ) : null}
          {data?.entries.length === 0 ? (
            <p className="text-micro text-basic-muted px-2 py-3">
              {kind === "toml"
                ? "No directories or .toml files here."
                : kind === "file"
                  ? "Nothing here."
                  : "No subdirectories here."}
              {hidden ? "" : " Hidden entries are not listed."}
            </p>
          ) : null}
          {data?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={cn(
                "flex min-h-11 md:min-h-9 items-center gap-3 md:gap-2 w-full px-2 md:px-2 py-3 md:py-1.5 rounded-[4px] text-left",
                "hover:bg-elevation-sublevel-variant-A",
                file === entry.path && "bg-elevation-sublevel-variant-A",
              )}
              onClick={() => (entry.is_directory ? goTo(entry.path) : setFile(entry.path))}
              onDoubleClick={() => {
                if (!entry.is_directory) onSelect(entry.path);
              }}
            >
              <Icon
                iconName={entry.is_directory ? IconName.Folder : IconName.File}
                size={isMobile ? 20 : 16}
                className="shrink-0 text-basic-muted"
              />
              <span
                className={cn(
                  "text-basic-primary truncate",
                  isMobile ? "text-small" : "text-small ",
                )}
              >
                {entry.name}
              </span>
            </button>
          ))}
          {data?.truncated ? (
            <p className="text-micro text-basic-muted px-2 py-2">
              Only the first entries are listed; type a path to go deeper.
            </p>
          ) : null}
        </div>

        <p className="text-small !leading-[22px] text-basic-secondary shrink-0 break-all">
          {chosen ? `Selected: ${chosen}` : "Nothing selected yet."}
        </p>
      </div>
    </Modal>
  );
}
