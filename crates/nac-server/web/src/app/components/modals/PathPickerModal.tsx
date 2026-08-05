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
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { errorMessage } from "@/app/providers/ToastProvider";
import {
  useBrowsePath,
  useSshBrowsePath,
  type BrowseKind,
} from "@/app/services/queries";
import type { SshTarget } from "@/app/types/api";

/**
 * Picks a path from the machine running the server, or from an SSH host when
 * `ssh` names one.
 *
 * Browsers never hand a web page an absolute path — `<input type="file">` and
 * the File System Access API both withhold it — so the filesystem is browsed
 * through the API instead of through the operating system's dialog. A remote
 * host is browsed the same way for the same reason, one directory per request.
 */
export function PathPickerModal({
  open,
  kind,
  initialPath,
  ssh,
  onClose,
  onSelect,
}: {
  open: boolean;
  kind: BrowseKind;
  initialPath: string;
  /** Browses this host instead of the local filesystem. */
  ssh?: SshTarget | null;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  if (!open) return null;
  return (
    <PathPicker
      kind={kind}
      initialPath={initialPath}
      ssh={ssh ?? null}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

function PathPicker({
  kind,
  initialPath,
  ssh,
  onClose,
  onSelect,
}: {
  kind: BrowseKind;
  initialPath: string;
  ssh: SshTarget | null;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const pickingFile = kind === "toml";
  // A directory is picked from an empty path so the server starts at its root,
  // or the host at the login home.
  const [directory, setDirectory] = useState(initialPath.trim());
  const [draft, setDraft] = useState(initialPath.trim());
  const [file, setFile] = useState<string | null>(null);
  // Both hooks are called every render, as hooks must be; the one that is not
  // the source of this listing is disabled and never fetches.
  const local = useBrowsePath(directory || null, kind, !ssh);
  const remote = useSshBrowsePath(ssh, directory || null, Boolean(ssh));
  const { data, error, isFetching } = ssh ? remote : local;

  const goTo = (path: string) => {
    setDirectory(path);
    setDraft(path);
    setFile(null);
  };

  const chosen = pickingFile ? file : (data?.path ?? directory);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        pickingFile
          ? "Select Config File"
          : ssh
            ? `Select Working Directory on ${ssh.ssh_host}`
            : "Select Working Directory"
      }
      size={ModalSize.Wide}
      flush
      className="h-[560px]"
      footer={
        <>
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Medium}
            content={ButtonContent.Text}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.Primary}
            size={ButtonSize.Medium}
            content={ButtonContent.Text}
            disabled={!chosen}
            onClick={() => {
              if (chosen) onSelect(chosen);
            }}
          >
            Select
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 h-full min-h-0">
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            disabled={!data?.parent}
            onClick={() => data?.parent && goTo(data.parent)}
            aria-label="Parent directory"
          >
            <Icon iconName={IconName.Top} />
          </Button>
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            disabled={!data?.home}
            onClick={() => data?.home && goTo(data.home)}
            aria-label="Home directory"
          >
            <Icon iconName={IconName.Home} />
          </Button>
          <Input
            inputSize={InputSize.Medium}
            className="flex-1 min-w-0"
            placeholder={ssh ? "~/path/on/the/host" : "/path/to/directory"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") goTo(draft.trim());
            }}
          />
        </div>

        {error ? (
          <p className="label-micro text-error-primary shrink-0">
            {errorMessage(error)}
          </p>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto rounded-[4px] bg-input shadow-concave p-1 flex flex-col [&>*]:shrink-0">
          {isFetching && !data ? (
            <div className="flex items-center justify-center py-6">
              <Loader size={LoaderSize.Small} />
            </div>
          ) : null}
          {data?.entries.length === 0 ? (
            <p className="text-micro text-basic-muted px-2 py-3">
              {pickingFile
                ? "No directories or .toml files here."
                : "No subdirectories here."}
            </p>
          ) : null}
          {data?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={cn(
                "flex items-center gap-2 w-full px-2 py-1.5 rounded-[4px] text-left",
                "hover:bg-elevation-sublevel-variant-A",
                file === entry.path && "bg-elevation-sublevel-variant-A",
              )}
              onClick={() =>
                entry.is_directory ? goTo(entry.path) : setFile(entry.path)
              }
              onDoubleClick={() => {
                if (!entry.is_directory) onSelect(entry.path);
              }}
            >
              <Icon
                iconName={entry.is_directory ? IconName.Folder : IconName.File}
                size={16}
                className="shrink-0 text-basic-muted"
              />
              <span className="paragraph-small text-basic-primary truncate">
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

        <p className="text-micro text-basic-muted shrink-0 truncate">
          {chosen ? `Selected: ${chosen}` : "Nothing selected yet."}
        </p>
      </div>
    </Modal>
  );
}
