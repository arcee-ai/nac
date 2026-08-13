# Skills

Skills are directories that contain a `SKILL.md` file. nac discovers them from project and user skill trees, shows the orchestrator a compact catalog, and preloads selected skills into worker threads. Workers cannot activate skills themselves: there is no `activate_skill` tool, and workers do not receive an available-skills listing.

## Discovery

Skill trees are scanned in this order. The first definition of a given skill name wins; later copies are skipped with a shadow warning.

| Precedence | Host path | Sandbox guest path |
| --- | --- | --- |
| 1 (highest) | `<project-root>/.nac/skills` | `/nac/skills/project/nac` |
| 2 | `<project-root>/.agents/skills` | `/nac/skills/project/agents` |
| 3 | `$NAC_HOME/skills` | `/nac/skills/user/nac-home` |
| 4 (lowest) | `~/.agents/skills` | `/nac/skills/user/agents-home` |

Project root is the nearest ancestor with a `.git` marker, otherwise the session workspace. `NAC_HOME` follows the same resolution as the rest of nac (`$NAC_HOME`, else `$XDG_CONFIG_HOME/nac`, else `~/.config/nac`). Duplicate host roots are dropped.

Each tree is walked up to 6 directory levels and 2,000 directories. `.git`, `node_modules`, `target`, `.venv`, and `__pycache__` are skipped. A directory that contains `SKILL.md` is treated as one skill; nac does not look for nested skills inside it.

With `--sandbox`, only user trees (`$NAC_HOME/skills` and `~/.agents/skills`) are registered; project trees are not. Over SSH, the same user-only rule applies, and `AGENTS.md` is not loaded. Skill source directories that exist are still auto-mounted read-only into the sandbox at the guest paths above, unless a workspace mount already covers them. See [Sandbox](sandbox.md).

## `SKILL.md` format

Each skill file must start with YAML frontmatter and a non-empty Markdown body:

```md
---
name: lint
description: Run the project's lint workflow.
compatibility: Optional note shown in the catalog.
---

Instructions the worker should follow.
```

`name` and `description` are required. A missing or empty description or body skips the skill with a warning. If `name` does not match the parent directory, nac still loads it and warns. Unquoted `description` values that contain colons are repaired so they parse as YAML.

nac ignores `disable-model-invocation`. Avoid interactive skills: nac is intended to run rather autonomously.

Optional files under `scripts/`, `references/`, and `assets/` (at most 64 total) are listed as skill resources and included when the skill is activated.

## How the orchestrator uses skills

The orchestrator never calls `activate_skill`. When a registry is present, the `thread` tool gains a `skills` array: names from the catalog, with a compact description of each skill (and `compatibility` when set). The orchestrator prompt tells it to pass `skills` when a dispatch clearly matches those names.

Unknown names fail the dispatch. Duplicates are ignored. Selected skills are preloaded as worker system messages (`The orchestrator preloaded this skill for this worker dispatch.`) that include the skill body, optional compatibility, the skill directory, and any resource file list.

On a local unsandboxed session the skill directory is the real host path. Under sandbox or SSH it is the placeholder `[filepath-not-visible]`, because the model cannot use host paths on those backends. Relative paths in the skill are relative to that directory.
