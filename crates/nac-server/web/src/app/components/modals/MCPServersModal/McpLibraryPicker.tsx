import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { EntryThumbnail } from "@/app/components/modals/MCPServersModal/McpEntryDetails";
import { FooterButton } from "@/app/components/modals/ModalFooterButton";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useMcpLibrary, useMcpServers } from "@/app/services/queries";
import type { McpLibraryEntry } from "@/app/types/api";

/**
 * The curated catalog. Embedded in the binary today; entries will later come
 * from a remote index, so the picker treats the list as data either way.
 */
export function LibraryPicker({
  onPick,
  onCustom,
  onClose,
  setFooter,
}: {
  onPick: (entry: McpLibraryEntry) => void;
  onCustom: () => void;
  /**
   * Dismisses the whole dialog from a Close button in the surrounding footer.
   * A phone panel shows the catalog as a dialog of its own, whose header
   * already leads with the way out, so there both of these are left off.
   */
  onClose?: () => void;
  setFooter?: (footer: ReactNode) => void;
}) {
  const isMobile = useIsMobile();
  const { data } = useMcpLibrary();
  const { data: serverData } = useMcpServers();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const entry of data?.entries ?? []) {
      if (!seen.includes(entry.category)) seen.push(entry.category);
    }
    return seen;
  }, [data]);
  // Entries already saved as a server: matched by the recorded library id,
  // or by name for servers created before the id was recorded.
  const installed = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const server of serverData?.servers ?? []) {
      if (server.library_id) ids.add(server.library_id);
      names.add(server.name);
    }
    return (entry: McpLibraryEntry) => ids.has(entry.id) || names.has(entry.name);
  }, [serverData]);
  // Grouped by category before a search; a flat filtered list while typing.
  // A query searches names and descriptions, falling back to tags when
  // nothing matches directly.
  const sections = useMemo(() => {
    const all = (data?.entries ?? []).filter(
      (entry) => category === null || entry.category === category,
    );
    const needle = query.trim().toLowerCase();
    if (needle) {
      const direct = all.filter(
        (entry) =>
          entry.name.toLowerCase().includes(needle) ||
          entry.description.toLowerCase().includes(needle),
      );
      const matches =
        direct.length > 0
          ? direct
          : all.filter((entry) => entry.tags.some((tag) => tag.toLowerCase().includes(needle)));
      return matches.length > 0 ? [{ category: null, entries: matches }] : [];
    }
    const grouped: { category: string | null; entries: McpLibraryEntry[] }[] = [];
    for (const entry of all) {
      const section = grouped.find((candidate) => candidate.category === entry.category);
      if (section) {
        section.entries.push(entry);
      } else {
        grouped.push({ category: entry.category, entries: [entry] });
      }
    }
    return grouped;
  }, [data, query, category]);

  useLayoutEffect(() => {
    if (!onClose || !setFooter) return undefined;
    setFooter(
      <FooterButton isMobile={isMobile} variant={ButtonVariant.Secondary} onClick={onClose}>
        Close
      </FooterButton>,
    );
    return () => setFooter(null);
  }, [isMobile, onClose, setFooter]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Search, the custom-server escape hatch and the category filter stay
          put while the catalog scrolls under them: the list runs long enough
          that scrolling back to reach them would cost more than the room they
          take. */}
      <div className="shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-4 pt-4">
          <Input
            className="flex-1 min-w-0"
            inputSize={InputSize.Medium}
            leading={InputLeading.Icon}
            leadingIconName={IconName.Search}
            placeholder="Search the library"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            className="shrink-0"
            onClick={onCustom}
          >
            {isMobile ? "Custom" : "Custom server"}
          </Button>
        </div>
        {categories.length > 1 ? (
          // One scrolling line instead of a wrapped block, so a long list of
          // categories cannot push the catalog itself out of the dialog.
          <div className="overflow-x-auto scrollbar-none [&>*]:shrink-0">
            <div className="flex gap-1.5 px-4 py-2">
              {[null, ...categories].map((item) => (
                <Button
                  key={item ?? "all"}
                  size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
                  variant={category === item ? ButtonVariant.Primary : ButtonVariant.Secondary}
                  content={ButtonContent.Text}
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                  className={isMobile ? "!rounded-full" : ""}
                >
                  {item ?? "All"}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          "flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2 [&>*]:shrink-0",
          // Clearance for the footer floating over the body, when there is one.
          isMobile && onClose && "pb-[88px]",
        )}
      >
        {sections.map((section) => (
          <div key={section.category ?? "search"} className="flex flex-col gap-2 [&>*]:shrink-0">
            {section.category !== null ? (
              <span className="tag-label text-basic-muted pt-6 px-1">{section.category}</span>
            ) : null}
            {section.entries.map((entry) => {
              const added = installed(entry);
              return (
                <TabButton
                  key={entry.id}
                  size={TabButtonSize.Large}
                  disabled={added}
                  className={cn(added && "opacity-50", "!px-2")}
                  onClick={() => onPick(entry)}
                >
                  <EntryThumbnail entry={entry} />
                  <div className="flex flex-col items-start text-left min-w-0 flex-grow py-1">
                    <div className="flex items-center gap-2">
                      <span className="label-small text-basic-primary">{entry.name}</span>
                      {added ? (
                        <Badge text="Added" color={BadgeColor.Green} />
                      ) : entry.auth === "required_header" ? (
                        <Badge text="Key required" color={BadgeColor.Yellow} />
                      ) : null}
                    </div>
                    <span className="text-micro text-basic-muted truncate w-full">
                      {entry.description}
                    </span>
                  </div>
                  {added ? null : <Icon iconName={IconName.Right} className="shrink-0" />}
                </TabButton>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
