import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, ButtonVariant, Select } from "@/app/atoms";
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
  const save = (spec: HeartbeatSpec) =>
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
  const openCreate = () => {
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
      <main className="flex-1 min-w-0 overflow-auto px-4 md:px-8 py-4 pt-18">
        <div className="max-w-5xl mx-auto flex flex-col gap-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="header-lg">Interval tasks</h1>
              <p className="text-basic-muted text-small">
                Fresh retained direct tasks from a saved Local project. No automatic goal.
              </p>
            </div>
            <Link to={routes.list()} className="text-small underline">
              All projects
            </Link>
          </header>
          <div
            className="flex flex-wrap gap-3 items-center"
            aria-label="Schedule project selection"
          >
            <Select
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
            <Button
              variant={ButtonVariant.Primary}
              disabled={!available || busy}
              onClick={openCreate}
            >
              New task schedule
            </Button>
          </div>
          {projects.error && <p role="alert">{projects.error.message}</p>}
          {managed.isManaged && (
            <p role="alert">Fresh interval tasks require an unmanaged Local host.</p>
          )}
          {projectId && !project && projects.isSuccess && (
            <p role="status">
              The destination project was removed. Retained receipts remain inspectable; future
              launches cannot rebind to another project.
            </p>
          )}
          {project?.ssh_host && <p role="alert">SSH interval tasks are not qualified.</p>}
          {schedules.error && (
            <div role="alert" className="rounded border border-muted p-3 flex flex-wrap gap-2">
              <p className="w-full">{schedules.error.message}</p>
              {schedules.intent && (
                <Button disabled={schedules.control.isPending} onClick={schedules.retry}>
                  Retry same request
                </Button>
              )}
              {schedules.rejected && (
                <Button
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
          <div className="grid md:grid-cols-[240px_minmax(0,1fr)] gap-5">
            <nav aria-label="Interval schedules" className="flex flex-col gap-2">
              {schedules.inventory.isPending && <p role="status">Loading schedules…</p>}
              {schedules.inventory.error && <p role="alert">{schedules.inventory.error.message}</p>}
              {schedules.inventory.data?.map((item) => (
                <Button
                  key={item.schedule_id}
                  disabled={busy}
                  variant={
                    selected === item.schedule_id ? ButtonVariant.Primary : ButtonVariant.Ghost
                  }
                  onClick={() => {
                    const target = item.binding.project_id;
                    if (target && target !== projectId)
                      navigate(
                        `${routes.taskSchedules(target)}?schedule=${encodeURIComponent(item.schedule_id)}`,
                      );
                    else choose(item.schedule_id);
                  }}
                >
                  {item.spec.name} · {item.state}
                </Button>
              ))}
              {schedules.inventory.data?.length === 0 && (
                <p className="text-basic-muted">No interval task schedules.</p>
              )}
            </nav>
            <section className="flex flex-col gap-4 min-w-0">
              {form ? (
                <>
                  {source.isPending && <p role="status">Checking saved project source…</p>}
                  {source.error && <p role="alert">{source.error.message}</p>}
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
                    </HeartbeatForm>
                  )}
                </>
              ) : schedule ? (
                <>
                  <h2 className="header-md">{schedule.spec.name}</h2>
                  <p role="status">
                    {schedule.state}
                    {schedule.reason ? ` · ${schedule.reason}` : ""}
                  </p>
                  <p className="text-small text-basic-muted">
                    Next anchored occurrence: {new Date(schedule.next_due_ms).toLocaleString()}.{" "}
                    {schedule.starts} launches accepted.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
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
                      disabled={busy || !available || schedule.state !== "active"}
                      onClick={() => act("run_now")}
                    >
                      Run now
                    </Button>
                    <Button disabled={busy || !editable} onClick={() => act("pause")}>
                      Pause
                    </Button>
                    <Button
                      disabled={
                        busy || !available || !["paused", "suspended"].includes(schedule.state)
                      }
                      onClick={() => act("resume")}
                    >
                      Resume
                    </Button>
                    <Button
                      disabled={busy || ["stopped", "deleted", "finished"].includes(schedule.state)}
                      onClick={() => act("stop")}
                    >
                      Stop schedule
                    </Button>
                    <Button
                      disabled={busy || schedule.state === "deleted"}
                      onClick={() => act("delete")}
                    >
                      Delete schedule
                    </Button>
                  </div>
                  <p className="text-small text-basic-muted">
                    Pause withdraws unstarted occurrences. Stop also targets this schedule's exact
                    active initial run. Delete retains active receipts; task/workspace resources are
                    never cleaned up automatically.
                  </p>
                  <details>
                    <summary className="cursor-pointer">Saved instructions and choices</summary>
                    <div className="flex flex-col gap-2 py-3">
                      <p className="whitespace-pre-wrap">{schedule.spec.instructions}</p>
                      <p>Skills: {(schedule.spec.skills ?? []).join(", ") || "None"}</p>
                      <p>End condition: {schedule.spec.end_condition}</p>
                      <p>
                        Model: {schedule.binding.fresh_task?.model ?? "Destination default"} ·
                        Reasoning:{" "}
                        {schedule.binding.fresh_task?.reasoning_effort ?? "Destination default"}
                      </p>
                      <p className="break-all">Local · {schedule.binding.cwd}</p>
                      <p>
                        Creator provenance:{" "}
                        {schedule.binding.creator_session_id ?? "Human project management"};
                        execution is independent of that chat.
                      </p>
                    </div>
                  </details>
                  <p>
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
                  <h3 className="header-sm">Produced tasks and exact initial results</h3>
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
                  <details>
                    <summary className="cursor-pointer">Recent occurrence history</summary>
                    <div className="flex flex-col gap-3 py-3">
                      {inspection?.heartbeat.history.map((item) => (
                        <article key={item.occurrence_id} className="border-t border-muted pt-2">
                          <p>
                            {item.outcome ?? item.state} · {item.coalesced_count} coalesced check(s)
                            · {new Date(item.due_first_ms).toLocaleString()}
                          </p>
                          <p>{item.evidence}</p>
                          {item.run_id && (
                            <p className="break-all">Exact initial run: {item.run_id}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <p className="text-basic-muted">
                  Select a schedule to inspect its saved purpose, limits, retained tasks and exact
                  initial results. Select a saved Local project to create one.
                </p>
              )}
              {schedules.inspection.error && (
                <p role="alert">{schedules.inspection.error.message}</p>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
