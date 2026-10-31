import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useSessionBehaviorIconVisible } from "@/app/features/ui-policy/useSessionBehaviorIconVisible";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  ChatSessionButton,
  Modal,
  ProjectButton,
  StickyInput,
  StickyInputVariant,
} from "@/app/atoms";
import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { ProjectRowActions } from "@/app/components/projects/ProjectRowActions";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun, parseStoreTime } from "@/app/lib/format";
import { projectEntries, primarySessions } from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useProjects, useVisibleSessions } from "@/app/services/queries";

/**
 * Search over the chats or the projects: one field above a flat list of what
 * it matches. The phone menu opens it as a screen of its own, with a clear
 * button in the field and 48px rows whose controls are always shown. The
 * desktop sidebar opens it as a card with neither: bare 36px rows that only
 * navigate.
 * Picking a row closes it, and the menu under it, then navigates; the row on
 * screen changes no route, which alone would close them.
 */
export function MobileSearchModal({
  open,
  onClose,
  onNavigate,
  kind,
  activeSessionId,
  activeProjectId,
}: {
  open: boolean;
  onClose: () => void;
  /** Closes the phone menu under this screen once a row is picked. */
  onNavigate?: () => void;
  kind: "chats" | "projects";
  activeSessionId: string | null;
  activeProjectId: string | null;
}) {
  const isMobile = useIsMobile();
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const close = () => {
    setQuery("");
    onClose();
  };
  const picked = () => {
    close();
    onNavigate?.();
  };
  const needle = query.trim().toLowerCase();
  const chats = kind === "chats";

  // The dialog focuses its own card so a phone keeps the keyboard down. On a
  // desktop nothing pops up, and the card only opens to be typed into.
  useEffect(() => {
    if (open && !isMobile) field.current?.focus();
  }, [open, isMobile]);

  return (
    <Modal
      open={open}
      onClose={close}
      title={chats ? "Search Chats" : "Search Projects"}
      className="max-w-[380px] h-[700px]"
      bodyClassName="p-0 [&>*]:shrink-0"
    >
      <div className="sticky top-0 z-10 flex p-3">
        <StickyInput
          ref={field}
          className="flex-1 min-w-0"
          variant={StickyInputVariant.Search}
          placeholder={chats ? "Search chats…" : "Search projects…"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={isMobile ? () => setQuery("") : undefined}
          aria-label={chats ? "Search chats" : "Search projects"}
        />
      </div>
      <div className="flex flex-col gap-2 px-2 py-8 [&>*]:shrink-0">
        {chats ? (
          <ChatResults
            needle={needle}
            activeSessionId={activeSessionId}
            isMobile={isMobile}
            onPicked={picked}
          />
        ) : (
          <ProjectResults
            needle={needle}
            activeProjectId={activeProjectId}
            isMobile={isMobile}
            onPicked={picked}
          />
        )}
      </div>
    </Modal>
  );
}

function ChatResults({
  needle,
  activeSessionId,
  isMobile,
  onPicked,
}: {
  needle: string;
  activeSessionId: string | null;
  isMobile: boolean;
  onPicked: () => void;
}) {
  const navigate = useNavigate();
  const policy = useUiPolicy();
  const showBehaviorIcon = useSessionBehaviorIconVisible();
  const sessionActions = useSessionActions();
  const sessionTitle = useSessionTitle();
  const { data: sessions = [] } = useVisibleSessions();
  const rows = useMemo(
    () =>
      primarySessions(sessions)
        .filter((entry) => !needle || sessionTitle(entry.summary).toLowerCase().includes(needle))
        .sort(
          (left, right) =>
            Number(Boolean(right.summary.pinned)) - Number(Boolean(left.summary.pinned)) ||
            parseStoreTime(right.summary.updated_at) - parseStoreTime(left.summary.updated_at),
        ),
    [needle, sessionTitle, sessions],
  );

  if (rows.length === 0) return <Empty>{needle ? "No matching chats" : "No chats yet"}</Empty>;
  return rows.map((entry) => {
    const title = sessionTitle(entry.summary);
    const behavior = sessionBehaviorPresentation(entry.summary.behavior);
    return (
      <ChatSessionButton
        key={entry.summary.session_id}
        title={title}
        behavior={entry.summary.behavior}
        showBehaviorIcon={showBehaviorIcon}
        aria-label={policy.orchestrationEnabled ? `${title}, ${behavior.navigationLabel}` : title}
        active={entry.summary.session_id === activeSessionId}
        running={isActiveRun(entry.active_run)}
        forkedFromTitle={entry.summary.forked_from?.title}
        isMobile={isMobile}
        onClick={() => {
          onPicked();
          navigate(routes.session(entry.summary.session_id));
        }}
        actions={
          isMobile ? (
            <ChatSessionActions
              title={title}
              pinned={entry.summary.pinned}
              isMobile
              onPin={() => void sessionActions.togglePin(entry.summary)}
              onRename={() => sessionActions.rename(entry.summary)}
              onDelete={() => sessionActions.remove(entry.summary)}
            />
          ) : undefined
        }
      />
    );
  });
}

function ProjectResults({
  needle,
  activeProjectId,
  isMobile,
  onPicked,
}: {
  needle: string;
  activeProjectId: string | null;
  isMobile: boolean;
  onPicked: () => void;
}) {
  const navigate = useNavigate();
  const { data: projectList } = useProjects();
  const { data: sessions = [] } = useVisibleSessions();
  const rows = useMemo(
    () =>
      projectEntries(projectList?.projects ?? [], sessions).filter(
        (entry) => !needle || entry.project.name.toLowerCase().includes(needle),
      ),
    [needle, projectList, sessions],
  );

  if (rows.length === 0)
    return <Empty>{needle ? "No matching projects" : "No projects yet"}</Empty>;
  return rows.map((entry) => (
    <ProjectButton
      key={entry.project.project_id}
      entityId={entry.project.project_id}
      name={entry.project.name}
      active={entry.project.project_id === activeProjectId}
      running={entry.running > 0}
      isMobile={isMobile}
      actions={isMobile ? <ProjectRowActions project={entry.project} /> : undefined}
      onClick={() => {
        onPicked();
        navigate(routes.project(entry.project.project_id));
      }}
    />
  ));
}

function Empty({ children }: { children: string }) {
  return <p className="label-small px-3 text-basic-muted">{children}</p>;
}
