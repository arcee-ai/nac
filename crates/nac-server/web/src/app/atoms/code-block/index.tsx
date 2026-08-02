import React, { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { type CodeToken, highlightSource } from "../../lib/highlight";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import CopyButton from "../button/CopyButton";
import Icon, { IconName } from "../icon";
import Modal from "../modal";

export enum CodeBlockSize {
  Small = "code-small",
  Medium = "code-medium",
  Large = "code-large",
}

interface CodeBlockProps {
  code: string;
  /** highlight.js language name. Unknown values just render as plain text. */
  language?: string;
  size?: CodeBlockSize;
  title?: React.ReactNode;
  lineNumbers?: boolean;
  /** Wrap long lines instead of scrolling the block sideways. */
  wrap?: boolean;
  copyable?: boolean;
  /** Adds a button that reopens the same block in a full-screen dialog. */
  expandable?: boolean;
  maxHeight?: string;
  className?: string;
}

interface CodeBodyProps {
  code: string;
  lines: CodeToken[][] | null;
  lineNumbers: boolean;
  wrap: boolean;
}

const CodeBody: React.FC<CodeBodyProps> = ({
  code,
  lines,
  lineNumbers,
  wrap,
}) => {
  const plain = code.split("\n");
  const count = lines?.length ?? plain.length;

  return (
    <div className="flex min-w-0">
      {lineNumbers ? (
        <div
          aria-hidden="true"
          className="shrink-0 select-none py-2 pl-3 pr-2 text-right text-basic-muted border-r border-muted"
        >
          {Array.from({ length: count }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
      ) : null}
      <pre
        className={cn(
          "flex-1 min-w-0 py-2 px-3 text-basic-primary",
          wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto",
        )}
      >
        <code>
          {lines
            ? lines.map((tokens, index) => (
                <div key={index}>
                  {tokens.length === 0
                    ? "\u00a0"
                    : tokens.map((token, position) => (
                        <span key={position} className={token.className ?? undefined}>
                          {token.text}
                        </span>
                      ))}
                </div>
              ))
            : plain.map((line, index) => <div key={index}>{line || "\u00a0"}</div>)}
        </code>
      </pre>
    </div>
  );
};

/**
 * Read-only code viewer with optional chrome. Colouring reuses the lowlight
 * pass behind the diff viewer, so no second highlighter enters the bundle, and
 * the plain text is shown until (or unless) the tokens arrive.
 */
const CodeBlock: React.FC<CodeBlockProps> & { Size: typeof CodeBlockSize } = ({
  code,
  language,
  size = CodeBlockSize.Small,
  title,
  lineNumbers = false,
  wrap = false,
  copyable = true,
  expandable = false,
  maxHeight,
  className = "",
}) => {
  const [expanded, setExpanded] = useState(false);
  // Highlighting is asynchronous, so the result carries what it was computed
  // from; anything that no longer matches the props renders as plain text.
  const [highlighted, setHighlighted] = useState<{
    code: string;
    language: string;
    lines: CodeToken[][] | null;
  } | null>(null);

  useEffect(() => {
    if (!language) return undefined;
    let live = true;
    void highlightSource(language, code).then((lines) => {
      if (live) setHighlighted({ code, language, lines });
    });
    return () => {
      live = false;
    };
  }, [language, code]);

  const lines =
    highlighted?.code === code && highlighted.language === language
      ? highlighted.lines
      : null;

  const body = (
    <CodeBody code={code} lines={lines} lineNumbers={lineNumbers} wrap={wrap} />
  );
  const header = title || copyable || expandable;

  return (
    <div
      className={cn(
        "flex flex-col min-w-0 rounded-[8px] overflow-hidden",
        "bg-elevation-sublevel-variant-A border border-muted",
        "code [&>*]:shrink-0",
        size,
        className,
      )}
    >
      {header ? (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-muted">
          <div className="flex-1 min-w-0 truncate label-micro text-basic-secondary">
            {title ?? language}
          </div>
          {copyable ? <CopyButton value={code} title="Copy code" /> : null}
          {expandable ? (
            <Button
              variant={ButtonVariant.Tertiary}
              size={ButtonSize.Small}
              content={ButtonContent.Icon}
              aria-label="Expand code"
              onClick={() => setExpanded(true)}
            >
              <Icon iconName={IconName.FullScreen} />
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="min-w-0 overflow-auto" style={{ maxHeight }}>
        {body}
      </div>

      {expandable ? (
        <Modal
          open={expanded}
          onClose={() => setExpanded(false)}
          title={title ?? language ?? "Code"}
          fullScreen
          flush
          footer={<CopyButton value={code} title="Copy code" />}
        >
          <div className={cn("code", size)}>{body}</div>
        </Modal>
      ) : null}
    </div>
  );
};

CodeBlock.Size = CodeBlockSize;

export default CodeBlock;
