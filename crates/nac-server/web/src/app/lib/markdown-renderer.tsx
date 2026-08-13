import {
  Suspense,
  isValidElement,
  memo,
  use,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { useLocation, useNavigate } from "react-router-dom";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import CodeBlock, { CodeBlockSize } from "@/app/atoms/code-block";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { PerfProfiler } from "@/app/lib/PerfProfiler";
import { splitMarkdownBlocks } from "@/app/lib/markdown-blocks";
import { normalizeMath } from "@/app/lib/math-source";
import { perfRender } from "@/app/lib/perfDebug";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import {
  classifyMarkdownHref,
  markdownUrlTransform,
} from "@/app/lib/workspaceLink";
import { useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import {
  revealSidePanel,
  selectFile,
  selectFileListing,
  selectRevision,
} from "@/app/store/sessionLayoutStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import toml from "highlight.js/lib/languages/ini";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Only the languages an agent transcript realistically contains; the full
// highlight.js bundle would dwarf the rest of the app.
const languages = {
  bash,
  css,
  diff,
  go,
  json,
  markdown,
  python,
  rust,
  sql,
  toml,
  typescript,
  xml,
  yaml,
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [
  [rehypeHighlight, { languages, detect: true, ignoreMissing: true }] as const,
];

/** A plugin list as react-markdown takes it; the tuple types are not exported. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginList = any[];

interface MathPlugins {
  remark: PluginList;
  rehype: PluginList;
}

let mathPlugins: Promise<MathPlugins> | null = null;

/**
 * The pipeline with MathJax in it, assembled once the chunk carrying it lands.
 * The promise is cached so `use` only ever suspends on the first formula in a
 * session, and never again after that.
 */
function loadMathPlugins(): Promise<MathPlugins> {
  mathPlugins ??= import("@/app/lib/markdown-mathjax").then(
    ({ rehypeMathjaxPlugin, remarkMathPlugin }) => ({
      remark: [...remarkPlugins, remarkMathPlugin],
      // Ahead of the highlighter, which would otherwise tokenize the TeX of a
      // `language-math` block into spans before MathJax gets to read it.
      rehype: [rehypeMathjaxPlugin, ...rehypePlugins],
    }),
  );
  return mathPlugins;
}

/** Text of a fenced block, for the clipboard. Nested spans carry the tokens. */
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

function languageOf(node: ReactNode): string {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    return "plaintext";
  }
  const className = node.props.className ?? "";
  const match = /language-([\w+-]+)/.exec(className);
  if (match?.[1]) return match[1];
  return languageOf(node.props.children);
}

/**
 * Fenced block rendered as the design-system CodeBlock (header, copy,
 * fullscreen) — same chrome ArceeFM uses via CodeInput, with matching `my-6`.
 */
function CodeFence({ children }: { children?: ReactNode }) {
  const code = textOf(children).replace(/\n$/, "");
  const language = languageOf(children);
  return (
    <CodeBlock
      code={code}
      language={language === "plaintext" ? undefined : language}
      title={language}
      size={CodeBlockSize.Small}
      copyable
      expandable
      className="my-6"
    />
  );
}

function wrapStreaming(children: ReactNode, streaming: boolean): ReactNode {
  if (!streaming) return children;
  return <span className="streaming-chunk">{children}</span>;
}

/** Stable digest of a stylesheet, used only to tell two of them apart. */
function fingerprint(css: string): string {
  let hash = 0;
  for (let index = 0; index < css.length; index += 1) {
    hash = (hash * 31 + css.charCodeAt(index)) | 0;
  }
  return `${css.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

interface MarkdownRendererProps {
  children: string;
  /** Fade newly painted prose while the turn is still streaming. */
  streaming?: boolean;
}

/**
 * Chat links that point at workspace files. On a local session, ask nac-web to
 * open the path with the OS; otherwise fall back to the Files panel. A bare
 * relative href would otherwise resolve against the document origin, leave the
 * hash route, and land on the homescreen.
 */
function MarkdownLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const toast = useToast();
  const client = useQueryClient();
  const sessionId = sessionIdFromPath(location.pathname);
  const snapshot = sessionId
    ? client.getQueryData<SessionSnapshotResponse>(
        queryKeys.sessionSnapshot(sessionId),
      )
    : undefined;
  const kind = classifyMarkdownHref(href, [
    snapshot?.workspace?.host_root,
    snapshot?.metadata.workspace_host_path,
    snapshot?.metadata.cwd,
  ]);

  const openInFilesPanel = (path: string) => {
    if (!sessionId) return;
    selectRevision(null);
    selectFileListing("tree");
    selectFile(path);
    revealSidePanel(isMobile);
    navigate(routes.session(sessionId, "files"));
  };

  if (kind.kind === "workspace" && sessionId) {
    return (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          void api
            .openWorkspacePath(sessionId, kind.path)
            .catch((error: unknown) => {
              // Remote / sandbox sessions cannot open a host path; the Files
              // panel is the next-best place to land.
              const message =
                error instanceof Error ? error.message : String(error);
              if (!/only available for local sessions|lives only inside the sandbox/i.test(
                message,
              )) {
                toast.error(`Could not open file: ${message}`);
              }
              openInFilesPanel(kind.path);
            });
        }}
      >
        {children}
      </a>
    );
  }

  if (kind.kind === "workspace" || kind.kind === "blocked") {
    // No session to open into (or an absolute path we cannot map): keep the
    // label, but do not let the browser leave the hash route.
    return (
      <a
        {...props}
        href={href}
        onClick={(event) => event.preventDefault()}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      {...props}
      href={kind.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  );
}

// react-markdown never injects raw HTML, so no sanitizer is needed; links still
// have to be neutered because the model controls their target.
function buildComponents(streaming: boolean) {
  return {
    a: MarkdownLink,
    pre: ({ children }: { children?: ReactNode }) => (
      <CodeFence>{children}</CodeFence>
    ),
    table: ({ ...props }: ComponentPropsWithoutRef<"table">) => (
      <div className="overflow-x-auto">
        <table {...props} />
      </div>
    ),
    // The only stylesheet that can reach here is the one MathJax ships with
    // each formula it typesets, and those overlap almost entirely: a streamed
    // turn produces one per block, every message another copy. Naming them
    // lets React hoist them into the head and keep one of each instead.
    style: ({ children }: ComponentPropsWithoutRef<"style">) => {
      const css = typeof children === "string" ? children : "";
      if (!css) return null;
      return (
        <style href={`mathjax-${fingerprint(css)}`} precedence="mathjax">
          {css}
        </style>
      );
    },
    p: ({ children, ...props }: ComponentPropsWithoutRef<"p">) => (
      <p {...props}>{wrapStreaming(children, streaming)}</p>
    ),
    li: ({ children, ...props }: ComponentPropsWithoutRef<"li">) => (
      <li {...props}>{wrapStreaming(children, streaming)}</li>
    ),
    h1: ({ children, ...props }: ComponentPropsWithoutRef<"h1">) => (
      <h1 {...props}>{wrapStreaming(children, streaming)}</h1>
    ),
    h2: ({ children, ...props }: ComponentPropsWithoutRef<"h2">) => (
      <h2 {...props}>{wrapStreaming(children, streaming)}</h2>
    ),
    h3: ({ children, ...props }: ComponentPropsWithoutRef<"h3">) => (
      <h3 {...props}>{wrapStreaming(children, streaming)}</h3>
    ),
    h4: ({ children, ...props }: ComponentPropsWithoutRef<"h4">) => (
      <h4 {...props}>{wrapStreaming(children, streaming)}</h4>
    ),
    h5: ({ children, ...props }: ComponentPropsWithoutRef<"h5">) => (
      <h5 {...props}>{wrapStreaming(children, streaming)}</h5>
    ),
    h6: ({ children, ...props }: ComponentPropsWithoutRef<"h6">) => (
      <h6 {...props}>{wrapStreaming(children, streaming)}</h6>
    ),
  };
}

// Built once per mode rather than per render: react-markdown passes these
// straight through as element types, so a fresh object would give every
// paragraph, heading and list item a new type on each delta and React would
// remount the whole message instead of updating its text.
const streamingComponents = buildComponents(true);
const staticComponents = buildComponents(false);

function Parsed({
  source,
  streaming,
}: {
  source: string;
  streaming: boolean;
}) {
  // The delimiters a model writes are not the ones remark-math reads, and the
  // dollars it means as money have to be neutered before the parser pairs them
  // up — both only work on the source, so they happen here.
  const math = normalizeMath(source);
  const components = streaming ? streamingComponents : staticComponents;
  const withoutMath = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin tuple types are not exported
      rehypePlugins={rehypePlugins as any}
      urlTransform={markdownUrlTransform}
      components={components}
    >
      {math.source}
    </ReactMarkdown>
  );
  if (!math.hasMath) return withoutMath;
  // Until MathJax has loaded the very same text renders without it, TeX source
  // and all, which is a far better wait than a hole in the message.
  return (
    <Suspense fallback={withoutMath}>
      <ParsedWithMath source={math.source} components={components} />
    </Suspense>
  );
}

/** The same parse with MathJax in the pipeline, once its chunk has arrived. */
function ParsedWithMath({
  source,
  components,
}: {
  source: string;
  components: ReturnType<typeof buildComponents>;
}) {
  const plugins = use(loadMathPlugins());
  return (
    <ReactMarkdown
      remarkPlugins={plugins.remark}
      rehypePlugins={plugins.rehype}
      urlTransform={markdownUrlTransform}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
}

/**
 * A block of a message that is still streaming. Memoized because a stream only
 * appends: once a later block exists this text is settled, and re-parsing it is
 * pure waste that grows with every delta.
 */
const StreamedBlock = memo(function StreamedBlock({
  source,
}: {
  source: string;
}) {
  return <Parsed source={source} streaming />;
});

/**
 * Heavy half of the markdown support: the parser plus the syntax highlighter.
 * Always reach it through `lib/markdown`, which loads this chunk on demand.
 *
 * A live message is parsed block by block so a delta only costs the block it
 * landed in; a finished one is parsed as a single document, which is both the
 * canonical reading of the text and cheap now that it is parsed once.
 */
const MarkdownRenderer = memo(function MarkdownRenderer({
  children,
  streaming = false,
}: MarkdownRendererProps) {
  perfRender("Markdown");
  return (
    <PerfProfiler id="markdown">
      {streaming ? (
        splitMarkdownBlocks(children).map((source, index) => (
          // Blocks are append-only, so their position is their identity.
          <StreamedBlock key={index} source={source} />
        ))
      ) : (
        <Parsed source={children} streaming={false} />
      )}
    </PerfProfiler>
  );
});

export default MarkdownRenderer;
