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

/**
 * Where the session works: the project's own folder, or a new retained Git
 * checkout that leaves the working tree untouched. The checkout needs a direct
 * agent on a Local Git project, so it is offered only when `available`.
 */
export function WorkspacePicker({
  isolated,
  available,
  onChange,
  disabled,
}: {
  isolated: boolean;
  available: boolean;
  onChange: (isolated: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = isolated ? "Isolated checkout" : "Project folder";
  const choose = (next: boolean) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Large}
      content={
        <Menu label="Workspace">
          <MenuLabel>Workspace</MenuLabel>
          <MenuItem
            label="Project folder"
            hint="Works in the project's folder, on its current branch."
            checked={!isolated}
            onSelect={() => choose(false)}
          />
          <MenuItem
            label="Isolated checkout"
            hint={
              available
                ? "A new retained Git checkout. Your working tree stays untouched."
                : "Needs a direct agent in a local Git project."
            }
            checked={isolated}
            disabled={!available}
            onSelect={() => choose(true)}
          />
        </Menu>
      }
    >
      <Chip
        disabled={disabled}
        aria-label={`Workspace: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        icon={isolated ? IconName.FolderCopy : IconName.Folder}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </Chip>
    </Popover>
  );
}

/**
 * The ref an isolated checkout starts from. A typed branch, tag or commit
 * wins; otherwise it is the project's saved default branch.
 */
export function RefPicker({
  value,
  defaultRef,
  onChange,
  disabled,
}: {
  value: string;
  defaultRef: string | null;
  onChange: (ref: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const shown = value || defaultRef;
  const close = () => setOpen(false);
  const apply = () => {
    onChange(draft.trim());
    close();
  };
  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Large}
      content={
        <Menu label="Start from">
          <MenuLabel>Start from</MenuLabel>
          <div className="px-1 pb-1">
            <input
              autoFocus
              aria-label="Branch, tag or commit"
              placeholder={defaultRef ?? "Branch, tag or commit"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                apply();
              }}
              className="type-body-chrome h-8 w-full rounded-lg border border-tertiary bg-elevation-level-1 px-2.5 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary max-md:h-11 max-md:text-base"
            />
          </div>
          {defaultRef ? (
            <MenuItem
              label={`Default branch (${defaultRef})`}
              checked={!value}
              onSelect={() => {
                setDraft("");
                onChange("");
                close();
              }}
            />
          ) : (
            <p className="type-meta px-2.5 py-1.5 text-basic-tertiary">
              This project has no saved default branch yet; you can save one when the task starts.
            </p>
          )}
        </Menu>
      }
    >
      <Chip
        disabled={disabled}
        aria-label={shown ? `Start from ${shown}` : "Choose where to start from"}
        aria-haspopup="menu"
        aria-expanded={open}
        icon={IconName.Scheme}
        className="bg-[var(--f-wash-1)]"
        onClick={() => {
          setDraft(value);
          setOpen((current) => !current);
        }}
      >
        {shown ? `from ${shown}` : "Choose a ref"}
      </Chip>
    </Popover>
  );
}
