import SessionNameDisclosure, {
  useSessionNameDisclosure,
} from "@/app/atoms/session-name-disclosure";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, StatusDot } from "@/app/atoms";
import { SessionMenu } from "@/app/features/session-chrome/SessionMenu";
import { useSessionDrawer } from "@/app/features/session-chrome/useSessionDrawer";
import { useSessionFacts, type SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import { SidebarToggle, useSidebar } from "@/app/features/sidebar/useSidebar";
import { useTerminalLinkMode } from "@/app/features/terminal/terminalLinkMode";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { DEFAULT_SESSION_PANEL, routes, type SessionPanel } from "@/app/lib/routes";

import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";

/**
 * Whether the transcript below has scrolled away from its top, so the header
 * can draw its hairline only once something passes under it. Scroll events do
 * not bubble, so the chat column is watched in its capture phase.
 */
function useScrolledBelow(header: HTMLElement | null): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const column = header?.parentElement;
    if (!header || !column) return undefined;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || header.contains(target)) return;
      if (header.nextElementSibling?.contains(target) !== true) return;
      setScrolled(target.scrollTop > 0);
    };
    column.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => column.removeEventListener("scroll", onScroll, { capture: true });
  }, [header]);
  return scrolled;
}

/** "← Parent title": the way back up from a delegated transcript. */
function ParentCrumb({ facts, phone }: { facts: SessionFacts; phone: boolean }) {
  const navigate = useNavigate();
  const parent = facts.parent;
  const disclosure = useSessionNameDisclosure(parent?.title ?? "");
  if (!parent) return null;
  const open = () => navigate(routes.session(parent.id, "delegated"));
  return (
    <span className="flex min-w-0 shrink items-center">
      {disclosure.hint(
        <button
          type="button"
          aria-label={`${parent.title}, parent chat`}
          onClick={open}
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-pill text-basic-tertiary outline-none",
            "transition-colors duration-150 ease-out hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
            phone
              ? "size-11 shrink-0 justify-center hover:bg-[var(--f-wash-2)]"
              : "type-meta h-6 max-w-[180px] px-1.5 hover:bg-[var(--f-wash-2)]",
          )}
        >
          <Icon iconName={IconName.ArrowLeft} size={phone ? 20 : 14} className="shrink-0" />
          {phone ? null : <span className="truncate">{parent.title}</span>}
        </button>,
      )}
      {phone ? null : <span className="opacity-60">{disclosure.action}</span>}
      {disclosure.overlay}
    </span>
  );
}

function TitleBlock({
  sessionId,
  facts,
  compact,
}: {
  sessionId: string;
  facts: SessionFacts;
  compact: boolean;
}) {
  const managed = facts.lineage?.kind === "managed-orchestrator";
  const meta = managed ? ["Managed orchestrator", ...facts.meta] : facts.meta;
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={facts.status} size="md" />
        <SessionNameDisclosure
          key={sessionId}
          name={facts.title}
          running={facts.running}
          quietIcon
          className={cn("min-w-0 text-basic-primary", compact ? "type-strong" : "type-subheading")}
        />
      </div>
      {meta.length > 0 ? (
        <p className="type-meta truncate pl-4 text-basic-tertiary" title={meta.join(" · ")}>
          {meta.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The session header: 52px, quiet, one row. The title with its status dot and
 * one muted line of where it runs; then one control, the Session menu, for
 * every panel, detail and action (a dot on it when something is live). On a
 * phone it is the screen's own top bar: back, title, and that same control.
 */
export function TopSingleSessionHeader({
  sessionId,
  snapshot,
  entry,
  panel = DEFAULT_SESSION_PANEL,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
  /** The panel the route has open, after the behavior policy corrected it. */
  panel?: SessionPanel;
}) {
  const facts = useSessionFacts(sessionId, snapshot, entry);
  const drawer = useSessionDrawer(sessionId, panel);
  const phone = useIsMobile();
  const navigate = useNavigate();
  const sidebar = useSidebar();
  const native = useTerminalLinkMode() === "native-visible-anchor";
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const scrolled = useScrolledBelow(header);
  const menu = (
    <SessionMenu
      sessionId={sessionId}
      snapshot={snapshot}
      entry={entry}
      facts={facts}
      drawer={drawer}
    />
  );

  if (phone) {
    return (
      <header
        ref={setHeader}
        className={cn(
          "relative z-20 flex min-h-14 shrink-0 items-center gap-1 bg-elevation-ground px-1 pt-[env(safe-area-inset-top)]",
          "border-b transition-[border-color] duration-150 ease-out motion-reduce:transition-none",
          scrolled ? "border-muted" : "border-transparent",
        )}
      >
        {facts.parent ? (
          <ParentCrumb facts={facts} phone />
        ) : (
          <button
            type="button"
            aria-label="Home"
            onClick={() => navigate(routes.list())}
            className="flex size-11 shrink-0 items-center justify-center rounded-pill text-basic-secondary outline-none hover:bg-[var(--f-wash-2)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]"
          >
            <Icon iconName={IconName.ArrowLeft} size={20} />
          </button>
        )}
        <TitleBlock sessionId={sessionId} facts={facts} compact />
        {menu}
      </header>
    );
  }

  // In the native shell the window's traffic lights sit over the top-left
  // corner whenever the sidebar is hidden, so the leading control moves past them.
  const trafficLights = native && sidebar.mode !== "none" && !sidebar.open;
  return (
    <header
      ref={setHeader}
      className={cn(
        "relative z-20 flex h-[52px] shrink-0 items-center gap-3 bg-elevation-ground pr-3",
        trafficLights ? "pl-[80px]" : "pl-3",
        "border-b transition-[border-color] duration-150 ease-out motion-reduce:transition-none",
        scrolled ? "border-muted" : "border-transparent",
      )}
    >
      <SidebarToggle />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <ParentCrumb facts={facts} phone={false} />
        {facts.parent ? (
          <span aria-hidden className="type-meta pr-1 text-basic-muted">
            /
          </span>
        ) : null}
        <TitleBlock sessionId={sessionId} facts={facts} compact={false} />
      </div>
      {menu}
    </header>
  );
}
