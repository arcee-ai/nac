import { useRef } from "react";
import type React from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

const DEFAULT_HINT =
  "Supports TXT, MARKDOWN, PDF, HTML, XLSX, XLS, DOCX, CSV, EML, MSG, PPTX, XML, EPUB, PPT, MD, HTM. Max 15MB each.";

export interface FileInputFile {
  id: string;
  name: string;
  size: string;
}

interface FileInputProps {
  multiple?: boolean;
  accept?: string;
  files?: FileInputFile[];
  errors?: string[];
  hint?: React.ReactNode;
  disabled?: boolean;
  onFilesSelected?: (files: File[]) => void;
  onRemove?: (id: string) => void;
  className?: string;
}

/** Drop target for one or more files, with the selected rows and error lines. */
const FileInput: React.FC<FileInputProps> = ({
  multiple = false,
  accept,
  files = [],
  errors = [],
  hint = DEFAULT_HINT,
  disabled = false,
  onFilesSelected,
  onRemove,
  className = "",
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasErrors = errors.length > 0;
  const showUpload = files.length === 0 || hasErrors;
  const uploadLabel = multiple && files.length === 0 && !hasErrors ? "Upload files" : "Upload file";

  return (
    <div
      className={cn(
        "file-input flex w-full flex-col items-start gap-[10px] rounded-[8px] bg-input p-2",
        className,
      )}
      data-invalid={hasErrors || undefined}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const selected = event.target.files ? [...event.target.files] : [];
          onFilesSelected?.(selected);
          event.target.value = "";
        }}
      />
      {files.map((file) => (
        <div
          key={file.id}
          className="file-input-row flex w-full items-center gap-1 overflow-hidden rounded-[4px] bg-elevation-level-1 shadow-convex"
        >
          <Icon
            iconName={IconName.Attachment}
            size={16}
            aria-hidden="true"
            color="var(--color-fill-basic-primary)"
          />
          <span className="file-input-meta min-w-0 flex-1 truncate text-basic-primary">
            {file.name}
          </span>
          <span className="file-input-meta shrink-0 text-basic-tertiary">{file.size}</span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            disabled={disabled}
            className="flex size-4 shrink-0 items-center justify-center disabled:cursor-not-allowed"
            onClick={() => onRemove?.(file.id)}
          >
            <Icon
              iconName={IconName.Close}
              size={16}
              aria-hidden="true"
              color={disabled ? "var(--color-fill-basic-muted)" : "var(--color-fill-basic-primary)"}
            />
          </button>
        </div>
      ))}
      {showUpload ? (
        <Button
          variant={ButtonVariant.Secondary}
          size={ButtonSize.Medium}
          content={ButtonContent.IconLeft}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Icon iconName={IconName.FileUpload} aria-hidden="true" />
          {uploadLabel}
        </Button>
      ) : null}
      {errors.map((error, index) => (
        <p key={`${index}-${error}`} className="label-micro w-full text-error-primary">
          {error}
        </p>
      ))}
      {hint ? <p className="file-input-hint w-full text-basic-muted">{hint}</p> : null}
    </div>
  );
};

export default FileInput;
