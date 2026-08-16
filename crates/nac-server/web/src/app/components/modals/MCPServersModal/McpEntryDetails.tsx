import { useLayoutEffect, useRef, useState } from "react";

import { Badge, BadgeColor, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type { McpLibraryEntry } from "@/app/types/api";

/**
 * The entry's icon when it has one and it loads; its first letter otherwise.
 */
export function EntryThumbnail({ entry }: { entry: McpLibraryEntry }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="flex items-center justify-center size-10 shrink-0 rounded-md bg-elevation-sublevel-variant-B overflow-hidden">
      {entry.icon_url && !broken ? (
        <img
          src={entry.icon_url}
          alt=""
          className="size-8 object-contain"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="text-small text-basic-muted uppercase">{entry.name.charAt(0)}</span>
      )}
    </div>
  );
}

/**
 * The catalog entry's identity and description as a card: thumbnail, name,
 * category, auth badge, docs link, and the description clamped to three
 * lines with a toggle when it overflows.
 */
export function EntryDetails({ entry }: { entry: McpLibraryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const proseRef = useRef<HTMLSpanElement>(null);
  // The docs link renders separately, so an inline "Docs: <url>" fragment
  // (common in registry descriptions) is dropped from the prose.
  const description = entry.description
    .replace(/\bDocs:\s*https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // The toggle only appears when the clamp actually hides text.
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight);
  }, [description]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-muted p-3 bg-elevation-sublevel-variant-A">
      <div className="flex items-center gap-2 min-w-0">
        <EntryThumbnail entry={entry} />
        <div className="flex flex-col min-w-0 flex-grow">
          <div className="flex items-center gap-2 min-w-0">
            <span className="header-small text-basic-primary truncate">{entry.name}</span>
            {entry.auth === "required_header" ? (
              <Badge text="Key required" color={BadgeColor.Yellow} />
            ) : null}
          </div>
          <span className="tag-label text-basic-muted">{entry.category}</span>
        </div>
        <a
          href={entry.docs_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 shrink-0 text-small text-info-primary hover:underline"
        >
          <Icon iconName={IconName.BookOpen} />
          Docs
        </a>
      </div>
      {description ? (
        <>
          <span
            ref={proseRef}
            className={cn("text-small text-basic-muted", !expanded && "line-clamp-3")}
          >
            {description}
          </span>
          {clamped || expanded ? (
            <button
              type="button"
              className="self-start text-small text-basic-primary hover:underline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
