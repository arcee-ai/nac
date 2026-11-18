import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Select,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { LeftSidebar } from "@/app/components/LeftSidebar";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { useProjects, useSessions } from "@/app/services/queries";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { routes } from "@/app/lib/routes";
import type { FreshTaskDestination, HeartbeatAction, HeartbeatSpec } from "@/app/types/api";
import { HeartbeatForm } from "../HeartbeatForm";
import { DestinationFields } from "./DestinationFields";
import { ResourceInventory } from "./ResourceInventory";
import { RetainedAllowanceControls } from "./RetainedAllowanceControls";
import { useFreshTaskSchedules } from "./queries";

export default function ProjectTaskSchedulesPage() {
  const { projectId = "" } = useParams();
  return <ProjectSchedules key={projectId} projectId={projectId} />;
}

function ProjectSchedules({ projectId }: { projectId: string }) {
  const { api } = useNativeRuntime();
  const managed = useManagedHost();
  const projects = useProjects();
  const sessions = useSessions();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const selected = search.get("schedule");
  const schedules = useFreshTaskSchedules(projectId, selected);
  const inspection = schedules.inspection.data;
  const schedule = inspection?.heartbeat.schedule;
  const project = projects.data?.projects.find((project) => project.project_id === projectId);
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [modelError, setModelError] = useState(false);
  const [destination, setDestination] = useState<FreshTaskDestination>({
    project_id: projectId,
    pinned_commit: null,
    default_ref: null,
    model: null,
    reasoning_effort: null,
    retained_limit: 10,
  });
  const busy = schedules.intent !== null || schedules.control.isPending;
  const source = useQuery({
    queryKey: ["fresh-task-source", projectId],
    queryFn: ({ signal }) => api.taskLaunchSource(projectId, signal),
    enabled: form !== null && !!project && !project.ssh_host && !managed.isManaged,
    retry: false,
  });
  const available = !!project && !project.ssh_host && !managed.isManaged;
  const choose = (id: string) => {
    const next = new URLSearchParams(search);
    next.set("schedule", id);
    setSearch(next);
    setForm(null);
  };
  const act = (action: "pause" | "resume" | "stop" | "delete" | "run_now") => {
    if (schedule)
      schedules.submit(
        {
          action,
          schedule_id: schedule.schedule_id,
          expected_version: schedule.version,
        } as HeartbeatAction,
        null,
      );
  };
  const save = (spec: HeartbeatSpec) => {
    if (!destination.model_selection) {
      setModelError(true);
      return;
    }
    setModelError(false);
    schedules.submit(
      form === "edit" && schedule
        ? {
            action: "edit",
            schedule_id: schedule.schedule_id,
            expected_version: editingVersion ?? schedule.version,
            spec,
          }
        : { action: "create", spec },
      destination,
      (receipt) => choose(receipt.schedule.schedule_id),
    );
  };
  const openCreate = () => {
    setModelError(false);
    setDestination({
      project_id: projectId,
      pinned_commit: null,
      default_ref: null,
      model: null,
      reasoning_effort: null,
      retained_limit: 10,
    });
    setForm("create");
  };
  const editable = schedule && !["deleted", "stopped", "finished"].includes(schedule.state);
  return (
    <div className="flex h-full min-h-0 bg-elevation-ground">
      <LeftSidebar variant="session" />
      <main className="flex-1 min-w-0 overflow-auto">
        <header className="sticky top-0 z-20 flex h-[52px] items-center gap-2 border-b border-muted bg-elevation-ground/90 px-3 backdrop-blur-md md:px-5">
          <Link
            to={routes.list()}
            className="type-label inline-flex h-8 shrink-0 items-center gap-1 rounded-pill pr-3 pl-2 text-basic-tertiary transition-colors duration-150 ease-out hover:bg-elevation-sublevel-variant-B hover:text-basic-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus-outline)] max-md:h-11"
          >
            <Icon iconName={IconName.Left} size={16} />
            Home
          </Link>
          <span aria-hidden className="h-4 w-px shrink-0 bg-divider-muted" />
          <h1 className="type-strong min-w-0 truncate px-1 text-basic-primary">Interval tasks</h1>
        </header>
        <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-4 pt-6 pb-16 md:px-8 md:pt-10">
          <div className="flex flex-col gap-1.5">
            <p className="type-title text-basic-primary">{project?.name ?? "All schedules"}</p>
            <p className="type-body-chrome max-w-[64ch] text-basic-tertiary">
              Fresh retained direct tasks from a saved Local project, on an interval. No automatic
              goal.
            </p>
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Schedule project selection"
          >
            <Select
              triggerClassName={TOUCH}
              value={projectId || "all"}
              disabled={busy}
              placeholder="Choose saved Local project"
              items={[
                { id: "all", label: "All interval schedules" },
                ...(projects.data?.projects
                  .filter((project) => !project.ssh_host)
                  .map((project) => ({ id: project.project_id, label: project.name })) ?? []),
                ...(projectId && !project ? [{ id: projectId, label: "Removed destination" }] : []),
              ]}
              onValueChange={(id) =>
                navigate(id === "all" ? routes.taskSchedules() : routes.taskSchedules(id))
              }
            />
            <div className="flex-1" />
            <Button
              className={TOUCH}
              variant={ButtonVariant.Primary}
              content={ButtonContent.IconLeft}
              disabled={!available || busy}
              onClick={openCreate}
            >
              <Icon iconName={IconName.Add} />
              New task schedule
            </Button>
          </div>
          {projects.error && (
            <p role="alert" className={NOTICE_ERROR}>
              {projects.error.message}
            </p>
          )}
          {managed.isManaged && (
            <p role="alert" className={NOTICE_CAUTION}>
              Fresh interval tasks require an unmanaged Local host.
            </p>
          )}
          {projectId && !project && projects.isSuccess && (
            <p role="status" className={NOTICE_QUIET}>
              The destination project was removed. Retained receipts remain inspectable; future
              launches cannot rebind to another project.
            </p>
          )}
          {project?.ssh_host && (
            <p role="alert" className={NOTICE_CAUTION}>
              SSH interval tasks are not qualified.
            </p>
          )}
          {schedules.error && (
            <div role="alert" className={cn(NOTICE_ERROR, "flex flex-wrap items-center gap-2")}>
              <p className="w-full">{schedules.error.message}</p>
              {schedules.intent && (
                <Button
                  variant={ButtonVariant.Secondary}
                  size={ButtonSize.Small}
                  disabled={schedules.control.isPending}
                  onClick={schedules.retry}
                >
                  Retry same request
                </Button>
              )}
              {schedules.rejected && (
                <Button
                  variant={ButtonVariant.Secondary}
                  size={ButtonSize.Small}
                  onClick={() => {
                    schedules.reviewLatest();
                    setForm(null);
                  }}
                >
                  Review latest schedule
                </Button>
              )}
            </div>
          )}
          <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
            <nav aria-label="Interval schedules" className="flex flex-col gap-0.5">
              <p className="type-meta-strong px-2.5 pb-1.5 text-basic-tertiary">Schedules</p>
              {schedules.inventory.isPending && (
                <p role="status" className="type-body-chrome px-2.5 text-basic-tertiary">
                  Loading schedules…
                </p>
              )}
              {schedules.inventory.error && (
                <p role="alert" className="type-body-chrome px-2.5 text-error-primary">
                  {schedules.inventory.error.message}
                </p>
              )}
              {schedules.inventory.data?.map((item) => (
                <TabButton
                  key={item.schedule_id}
                  size={TabButtonSize.Medium}
                  className={TOUCH}
                  disabled={busy}
                  active={selected === item.schedule_id}
                  aria-current={selected === item.schedule_id ? "page" : undefined}
                  aria-label={`${item.spec.name} · ${item.state}`}
                  onClick={() => {
                    const target = item.binding.project_id;
                    if (target && target !== projectId)
                      navigate(
                        `${routes.taskSchedules(target)}?schedule=${encodeURIComponent(item.schedule_id)}`,
                      );
                    else choose(item.schedule_id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{item.spec.name}</span>
                  <span className="type-meta shrink-0 text-basic-muted">{item.state}</span>
                </TabButton>
              ))}
              {schedules.inventory.data?.length === 0 && (
                <p className="type-body-chrome px-2.5 text-basic-tertiary">
                  No interval task schedules yet.
                </p>
              )}
            </nav>
            <section className="flex min-w-0 flex-col gap-5">
              {form ? (
                <div className={CARD}>
                  {source.isPending && (
                    <p role="status" className="type-body-chrome text-basic-tertiary">
                      Checking saved project source…
                    </p>
                  )}
                  {source.error && (
                    <p role="alert" className="type-body-chrome text-error-primary">
                      {source.error.message}
                    </p>
                  )}
                  {source.data && (
                    <HeartbeatForm
                      key={`${form}:${selected}`}
                      freshTasks
                      initial={form === "edit" ? schedule?.spec : undefined}
                      disabled={busy || !available}
                      onSubmit={save}
                      onCancel={() => setForm(null)}
                    >
                      <DestinationFields
                        value={destination}
                        onChange={setDestination}
                        git={source.data.eligible}
                        savedDefaultRef={source.data.default_ref ?? null}
                      />
                      {modelError && (
                        <p role="alert" className="text-error-primary">
                          Choose a model for the scheduled task.
                        </p>
                      )}
                    </HeartbeatForm>
                  )}
                </div>
              ) : schedule ? (
                <>
                  <div className={cn(CARD, "gap-4")}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="type-heading min-w-0 break-words text-basic-primary">
                        {schedule.spec.name}
                      </h2>
                      <Badge
                        text={schedule.state}
                        color={
                          schedule.state === "active"
                            ? BadgeColor.Neutral
                            : schedule.state === "suspended"
                              ? BadgeColor.Yellow
                              : BadgeColor.Gray
                        }
                      />
                    </div>
                    <p role="status" className="type-body-chrome text-basic-secondary">
                      {schedule.state}
                      {schedule.reason ? ` · ${schedule.reason}` : ""}
                    </p>
                    <p className="type-body-chrome tabular text-basic-tertiary">
                      Next anchored occurrence: {new Date(schedule.next_due_ms).toLocaleString()}.{" "}
                      {schedule.starts} launches accepted.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className={TOUCH}
                        variant={ButtonVariant.Primary}
                        disabled={busy || !available || schedule.state !== "active"}
                        onClick={() => act("run_now")}
                      >
                        Run now
                      </Button>
                      <Button
                        className={TOUCH}
                        variant={ButtonVariant.Secondary}
                        disabled={busy || !available || !editable}
                        onClick={() => {
                          setDestination(schedule.binding.fresh_task!);
                          setEditingVersion(schedule.version);
                          setForm("edit");
                        }}
                      >
                        Edit schedule
                      </Button>
                      <Button
                        className={TOUCH}
                        variant={ButtonVariant.Secondary}
                        disabled={busy || !editable}
                        onClick={() => act("pause")}
                      >
                        Pause
                      </Button>
                      <Button
                        className={TOUCH}
                        variant={ButtonVariant.Secondary}
                        disabled={
                          busy || !available || !["paused", "suspended"].includes(schedule.state)
                        }
                        onClick={() => act("resume")}
                      >
                        Resume
                      </Button>
                      <Button
                        className={TOUCH}
                        variant={ButtonVariant.Secondary}
                        disabled={
                          busy || ["stopped", "deleted", "finished"].includes(schedule.state)
                        }
                        onClick={() => act("stop")}
                      >
                        Stop schedule
                      </Button>
                      <Button
                        className={TOUCH}
                        variant={ButtonVariant.GhostDestructive}
                        disabled={busy || schedule.state === "deleted"}
                        onClick={() => act("delete")}
                      >
                        Delete schedule
                      </Button>
                    </div>
                    <p className="type-meta text-basic-tertiary">
                      Pause withdraws unstarted occurrences. Stop also targets this schedule's exact
                      active initial run. Delete retains active receipts; task/workspace resources
                      are never cleaned up automatically.
                    </p>
                    <details className="group border-t border-muted pt-3">
                      <summary className="type-label cursor-pointer list-none text-basic-secondary hover:text-basic-primary [&::-webkit-details-marker]:hidden">
                        <span className="inline-flex items-center gap-1">
                          <Icon
                            iconName={IconName.Right}
                            size={14}
                            className="transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
                          />
                          Saved instructions and choices
                        </span>
                      </summary>
                      <div className="type-body-chrome flex flex-col gap-2 pt-3 text-basic-secondary">
                        <p className="whitespace-pre-wrap text-basic-primary">
                          {schedule.spec.instructions}
                        </p>
                        <p>Skills: {(schedule.spec.skills ?? []).join(", ") || "None"}</p>
                        <p>End condition: {schedule.spec.end_condition}</p>
                        <p>
                          Model: {schedule.binding.fresh_task?.model ?? "Destination default"} ·
                          Reasoning:{" "}
                          {schedule.binding.fresh_task?.reasoning_effort ?? "Destination default"}
                        </p>
                        <p className="break-all">Local · {schedule.binding.cwd}</p>
                        <p className="text-basic-tertiary">
                          Creator provenance:{" "}
                          {schedule.binding.creator_session_id ?? "Human project management"};
                          execution is independent of that chat.
                        </p>
                      </div>
                    </details>
                  </div>
                  <div className={cn(CARD, "gap-3")}>
                    <h3 className="type-subheading text-basic-primary">Retained resources</h3>
                    <p className="type-body-chrome tabular text-basic-secondary">
                      Retained reservations/resources: {inspection?.inventory.length ?? 0} /{" "}
                      {schedule.binding.fresh_task?.retained_limit} for this schedule.
                    </p>
                    {inspection && (
                      <RetainedAllowanceControls
                        key={schedule.schedule_id}
                        projectId={projectId}
                        allowance={inspection.host_allowance}
                        disabled={!available || busy}
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-3">
                    <h3 className="type-subheading text-basic-primary">
                      Produced tasks and exact initial results
                    </h3>
                    {inspection && (
                      <ResourceInventory
                        key={schedule.schedule_id}
                        inspection={inspection}
                        presentSessionIds={
                          sessions.isSuccess
                            ? new Set(sessions.data.map((session) => session.summary.session_id))
                            : undefined
                        }
                      />
                    )}
                  </div>
                  <details className={cn(CARD, "group")}>
                    <summary className="type-label cursor-pointer list-none text-basic-secondary hover:text-basic-primary [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-1">
                        <Icon
                          iconName={IconName.Right}
                          size={14}
                          className="transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
                        />
                        Recent occurrence history
                      </span>
                    </summary>
                    <div className="flex flex-col gap-3 pt-3">
                      {inspection?.heartbeat.history.map((item) => (
                        <article
                          key={item.occurrence_id}
                          className="type-body-chrome flex flex-col gap-1 border-t border-muted pt-3 text-basic-secondary"
                        >
                          <p className="tabular text-basic-primary">
                            {item.outcome ?? item.state} · {item.coalesced_count} coalesced check(s)
                            · {new Date(item.due_first_ms).toLocaleString()}
                          </p>
                          <p>{item.evidence}</p>
                          {item.run_id && (
                            <p className="type-meta break-all text-basic-tertiary">
                              Exact initial run: {item.run_id}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <div
                  className={cn(
                    CARD,
                    "items-start border-dashed bg-transparent py-10 text-basic-tertiary",
                  )}
                >
                  <Icon iconName={IconName.Clock} size={20} className="text-basic-muted" />
                  <p className="type-body-chrome max-w-[52ch]">
                    Select a schedule to inspect its saved purpose, limits, retained tasks and exact
                    initial results. Select a saved Local project to create one.
                  </p>
                </div>
              )}
              {schedules.inspection.error && (
                <p role="alert" className={NOTICE_ERROR}>
                  {schedules.inspection.error.message}
                </p>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Phone touch targets: a min-height outranks the matrix height on narrow screens. */
const TOUCH = "max-md:min-h-11";
/** A hairline card on the surface: the page's one container. */
const CARD = "flex flex-col rounded-card border border-tertiary bg-elevation-level-1 p-5";
const NOTICE_BASE = "type-body-chrome rounded-card border px-4 py-3";
const NOTICE_ERROR = cn(NOTICE_BASE, "border-error-secondary bg-error-primary text-error-primary");
const NOTICE_CAUTION = cn(
  NOTICE_BASE,
  "border-danger-secondary bg-danger-primary text-basic-primary",
);
const NOTICE_QUIET = cn(NOTICE_BASE, "border-tertiary text-basic-secondary");
