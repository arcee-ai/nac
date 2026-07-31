import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { HorizontalTabsItem, Icon, IconName } from "@/app/atoms";
import { EventsView } from "@/app/components/inspector/EventsView";
import { InspectorHeader } from "@/app/components/inspector/InspectorHeader";
import { MetricsBar } from "@/app/components/inspector/MetricsBar";
import { PromptForm } from "@/app/components/inspector/PromptForm";
import { ThreadsView } from "@/app/components/inspector/ThreadsView";
import { Transcript } from "@/app/components/inspector/Transcript";
import { WorksetsView } from "@/app/components/inspector/WorksetsView";
import { WorkspaceView } from "@/app/components/inspector/WorkspaceView";
import { useRunStateSync, useSessionStream } from "@/app/hooks/useSessionStream";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  DEFAULT_INSPECTOR_TAB,
  INSPECTOR_TABS,
  isInspectorTab,
  routes,
  type InspectorTab,
} from "@/app/lib/routes";
import { useSessions, useSessionSnapshot } from "@/app/services/queries";
import { clearAttention } from "@/app/store/attentionStore";
import { useRunning } from "@/app/store/runtimeStore";

const TAB_META: Record<InspectorTab, { label: string; icon: IconName }> = {
  chat: { label: "Chat", icon: IconName.Chat },
  events: { label: "Events", icon: IconName.Activity },
  threads: { label: "Threads", icon: IconName.Flow },
  worksets: { label: "Worksets", icon: IconName.Layers },
  workspace: { label: "Workspace", icon: IconName.Folder },
};

function RepairBanner({
  message,
  onSettings,
}: {
  message: string;
  onSettings: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-error-muted bg-error-tertiary text-error-primary shrink-0">
      <Icon iconName={IconName.Repair} />
      <div className="flex-grow min-w-0">
        <div className="label-small">Configuration needs repair</div>
        <div className="text-micro truncate">{message}</div>
      </div>
      <button
        type="button"
        className="label-small underline shrink-0 hover:opacity-80"
        onClick={onSettings}
      >
        Open settings
      </button>
    </div>
  );
}

/** The session screen is the inspector at full width; navigation lives in the breadcrumb. */
export default function SessionPage() {
  const { sessionId, tab } = useParams<{ sessionId: string; tab?: string }>();
  const navigate = useNavigate();
  const id = sessionId ?? null;

  const { data: snapshot = null, error } = useSessionSnapshot(id);
  const { data: sessions = [] } = useSessions();
  const actions = useSessionActions();
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);
  const running = useRunning();

  useEffect(() => {
    if (id) clearAttention(id);
  }, [id]);

  if (!id) return <Navigate to={routes.list()} replace />;
  if (!isInspectorTab(tab)) {
    return <Navigate to={routes.session(id, DEFAULT_INSPECTOR_TAB)} replace />;
  }

  const entry = sessions.find((item) => item.summary.session_id === id) ?? null;
  const configError = entry?.summary.model_config_error;
  // The repair banner already explains a broken config, and that is exactly why
  // the snapshot request fails, so only report an unexplained fetch failure.
  const fetchError = !configError && !snapshot && error ? errorMessage(error) : null;

  return (
    <section className="flex flex-col min-h-0 h-full pt-[52px] bg-elevation-level-0-5">
      <InspectorHeader
        sessionId={id}
        summary={entry?.summary ?? null}
        metadata={snapshot?.metadata ?? null}
        running={running}
      />

      {configError ? (
        <RepairBanner message={configError} onSettings={() => actions.settings(id)} />
      ) : null}
      {fetchError ? (
        <div className="px-4 py-2 border-b border-error-muted bg-error-tertiary text-error-primary label-small shrink-0">
          {fetchError}
        </div>
      ) : null}

      <nav className="flex gap-1 px-2 border-b border-primary shrink-0 overflow-x-auto">
        {INSPECTOR_TABS.map((name) => (
          <HorizontalTabsItem
            key={name}
            active={tab === name}
            iconName={TAB_META[name].icon}
            onClick={() => navigate(routes.session(id, name))}
          >
            {TAB_META[name].label}
          </HorizontalTabsItem>
        ))}
      </nav>

      <MetricsBar snapshot={snapshot} entry={entry} />

      <div className="flex-1 min-h-0">
        {tab === "chat" ? (
          <div className="flex flex-col h-full min-h-0">
            <Transcript snapshot={snapshot} />
            <PromptForm sessionId={id} />
          </div>
        ) : null}
        {tab === "events" ? <EventsView /> : null}
        {tab === "threads" ? <ThreadsView snapshot={snapshot} /> : null}
        {tab === "worksets" ? <WorksetsView snapshot={snapshot} /> : null}
        {tab === "workspace" ? (
          <WorkspaceView sessionId={id} snapshot={snapshot} />
        ) : null}
      </div>
    </section>
  );
}
