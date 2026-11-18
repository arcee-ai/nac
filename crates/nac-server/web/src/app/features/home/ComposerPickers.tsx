import { useState } from "react";

import { IconName, Popover, PopoverPlacement, PopoverSize, SessionAvatar } from "@/app/atoms";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/app/features/sidebar/MenuItem";
import type { ProjectRecord, SessionBehavior } from "@/app/types/api";

import { BEHAVIOR_CHOICES, behaviorLabel } from "./behaviors";
import { Chip } from "./Chip";

const FILTER_FROM = 8;

/** Which project the new session runs in, plus "Add project…". */
export function ProjectPicker({
  projects,
  value,
  onChange,
  onAddProject,
  addLabel,
  disabled,
}: {
  projects: readonly ProjectRecord[];
  value: ProjectRecord | null;
  onChange: (projectId: string) => void;
  onAddProject: () => void;
  addLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(needle) || project.cwd.toLowerCase().includes(needle),
      )
    : projects;
  const close = () => {
    setOpen(false);
    setFilter("");
  };
  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Medium}
      panelClassName="max-h-[min(420px,60vh)] overflow-y-auto"
      content={
        <Menu label="Project">
          {projects.length >= FILTER_FROM ? (
            <input
              autoFocus
              aria-label="Filter projects"
              placeholder="Filter projects"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="type-body-chrome mb-1 h-8 w-full rounded-lg border border-tertiary bg-elevation-level-1 px-2.5 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary max-md:h-11 max-md:text-base"
            />
          ) : (
            <MenuLabel>Project</MenuLabel>
          )}
          {shown.map((project) => (
            <MenuItem
              key={project.project_id}
              label={project.name}
              hint={project.cwd}
              checked={project.project_id === value?.project_id}
              onSelect={() => {
                onChange(project.project_id);
                close();
              }}
            />
          ))}
          {shown.length === 0 ? (
            <p className="type-meta px-2.5 py-2 text-basic-muted">No matching projects</p>
          ) : null}
          <MenuSeparator />
          <MenuItem
            icon={IconName.Add}
            label={addLabel}
            onSelect={() => {
              close();
              onAddProject();
            }}
          />
        </Menu>
      }
    >
      <Chip
        disabled={disabled}
        aria-label={value ? `Project: ${value.name}` : "Choose a project"}
        aria-haspopup="menu"
        aria-expanded={open}
        leading={value ? <SessionAvatar id={value.project_id} size={16} /> : undefined}
        icon={value ? undefined : IconName.Folder}
        onClick={() => setOpen((current) => !current)}
      >
        {value?.name ?? "Choose a project"}
      </Chip>
    </Popover>
  );
}

/** Agent / Agent + Orchestrator / Orchestrator. Behavior is fixed per session. */
export function BehaviorPicker({
  value,
  onChange,
  disabled,
}: {
  value: SessionBehavior;
  onChange: (behavior: SessionBehavior) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Large}
      content={
        <Menu label="Session behavior">
          <MenuLabel>Behavior is fixed for the life of the session</MenuLabel>
          {BEHAVIOR_CHOICES.map((choice) => (
            <MenuItem
              key={choice.id}
              label={choice.label}
              hint={choice.hint}
              checked={choice.id === value}
              onSelect={() => {
                onChange(choice.id);
                setOpen(false);
              }}
            />
          ))}
        </Menu>
      }
    >
      <Chip
        disabled={disabled}
        aria-label={`Behavior: ${behaviorLabel(value)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        icon={
          value === "orchestrator"
            ? IconName.Orchestrator
            : value === "direct-with-orchestrator"
              ? IconName.PlaneAdd
              : IconName.Plane
        }
        onClick={() => setOpen((current) => !current)}
      >
        {behaviorLabel(value)}
      </Chip>
    </Popover>
  );
}
