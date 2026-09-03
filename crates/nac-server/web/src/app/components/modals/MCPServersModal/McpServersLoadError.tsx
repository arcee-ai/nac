import { Button, ButtonContent, ButtonSize, ButtonVariant } from "@/app/atoms";

export function McpServersLoadError({
  error,
  retrying,
  onRetry,
}: {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}) {
  const detail =
    error instanceof Error ? error.message : "The MCP configuration could not be read.";

  return (
    <div className="flex h-full min-h-0 flex-col items-start justify-center gap-3 overflow-auto p-6">
      <div className="label-small text-error-primary">MCP servers could not be loaded.</div>
      <p className="max-w-full whitespace-pre-wrap break-words text-micro text-basic-secondary">
        {detail}
      </p>
      <Button
        variant={ButtonVariant.Secondary}
        size={ButtonSize.Small}
        content={ButtonContent.Text}
        loading={retrying}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
