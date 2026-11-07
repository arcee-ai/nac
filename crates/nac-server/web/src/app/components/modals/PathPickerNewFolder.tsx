import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
} from "@/app/atoms";
import { errorMessage } from "@/app/providers/ToastProvider";

import type { useNewFolder } from "./useNewFolder";

type NewFolder = ReturnType<typeof useNewFolder>;

/**
 * The inline form behind the picker's New folder button. It names one folder
 * inside the listed directory; the server decides whether that name is
 * acceptable, and its answer is shown here with the form left open.
 */
export function PathPickerNewFolder({
  folder,
  onOpen,
}: {
  folder: NewFolder;
  /** Browses into a folder the form found after an unconfirmed create. */
  onOpen: (path: string) => void;
}) {
  const { status, pending, blocked } = folder;
  return (
    <div role="group" aria-label="New folder" className="flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-2">
        <Icon iconName={IconName.Folder} size={16} className="shrink-0 text-basic-muted" />
        <Input
          inputSize={InputSize.Medium}
          className="flex-1 min-w-0"
          placeholder="New folder name"
          aria-label="New folder name"
          aria-invalid={status.kind === "refused"}
          autoFocus
          readOnly={pending}
          value={folder.name}
          onChange={(event) => folder.setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            folder.submit();
          }}
        />
        <Button
          variant={ButtonVariant.Primary}
          size={ButtonSize.Medium}
          content={ButtonContent.Text}
          disabled={pending || blocked}
          aria-busy={pending}
          onClick={folder.submit}
        >
          {status.kind === "creating" ? "Creating…" : "Create"}
        </Button>
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Text}
          onClick={folder.cancel}
        >
          Cancel
        </Button>
      </div>
      <NewFolderMessage folder={folder} onOpen={onOpen} />
    </div>
  );
}

function NewFolderMessage({
  folder,
  onOpen,
}: {
  folder: NewFolder;
  onOpen: (path: string) => void;
}) {
  const { status } = folder;
  const text = "label-micro text-error-primary";
  switch (status.kind) {
    case "editing":
    case "creating":
      return null;
    case "refused":
      return (
        <p role="alert" className={text}>
          {`Could not create “${status.name}”: ${errorMessage(status.error)}`}
        </p>
      );
    case "checking":
      return (
        <p role="status" className="label-micro text-basic-muted">
          {`No answer came back (${errorMessage(status.cause)}). Checking whether “${status.name}” was created…`}
        </p>
      );
    case "uncertain-exists":
      return (
        <div className="flex items-center gap-2">
          <p role="alert" className={`${text} flex-1 min-w-0`}>
            {`“${status.name}” exists now. The request may have created it before its answer was lost (${errorMessage(status.cause)}).`}
          </p>
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Small}
            content={ButtonContent.Text}
            onClick={() => onOpen(status.path)}
          >
            {`Open “${status.name}”`}
          </Button>
        </div>
      );
    case "uncertain-absent":
      return (
        <p role="alert" className={text}>
          {`“${status.name}” was not created (${errorMessage(status.cause)}). You can try again.`}
        </p>
      );
    case "uncertain-unknown":
      return (
        <div className="flex items-center gap-2">
          <p role="alert" className={`${text} flex-1 min-w-0`}>
            {`Could not tell whether “${status.name}” was created (${errorMessage(status.cause)}; checking failed: ${errorMessage(status.check)}). Check again before retrying.`}
          </p>
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Small}
            content={ButtonContent.Text}
            onClick={folder.checkAgain}
          >
            Check again
          </Button>
        </div>
      );
  }
}
