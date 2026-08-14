#!/bin/sh
# Install nac's onboarding skill for a chosen agent runtime.
set -eu

usage() {
  cat <<'EOF'
Usage: install-skill.sh [--target TARGET] [--path DIRECTORY]

Targets: auto, agents, nac, codex, claude, opencode, project
  auto     Install into ~/.agents/skills (the cross-agent default).
  agents   Install into ~/.agents/skills.
  nac      Install into $NAC_HOME/skills or ~/.config/nac/skills.
  codex    Install into $CODEX_HOME/skills or ~/.codex/skills.
  claude   Install into $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills.
  opencode Install into $XDG_CONFIG_HOME/opencode/skills or ~/.config/opencode/skills.
  project  Install into ./.agents/skills in the current project.

Use --path DIRECTORY to install into a custom skill directory for any other
compatible agent. --path cannot be combined with --target.

For a private nac repository, authenticate GitHub CLI (`gh auth login`) or set
GITHUB_TOKEN before running this installer.
EOF
}

target=auto
destination=
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
elif [ "$#" -eq 2 ] && [ "$1" = "--target" ]; then
  target="$2"
elif [ "$#" -eq 2 ] && [ "$1" = "--path" ]; then
  destination="$2"
elif [ "$#" -ne 0 ]; then
  usage >&2
  exit 2
fi

if [ -z "$destination" ]; then
  home_dir=${HOME:?HOME must be set}
  config_home=${XDG_CONFIG_HOME:-"$home_dir/.config"}

  case "$target" in
    auto|agents) destination="$home_dir/.agents/skills" ;;
    nac) destination="${NAC_HOME:-"$config_home/nac"}/skills" ;;
    codex) destination="${CODEX_HOME:-"$home_dir/.codex"}/skills" ;;
    claude) destination="${CLAUDE_CONFIG_DIR:-"$home_dir/.claude"}/skills" ;;
    opencode) destination="$config_home/opencode/skills" ;;
    project) destination="$(pwd)/.agents/skills" ;;
    *) echo "Unknown target: $target" >&2; usage >&2; exit 2 ;;
  esac
fi

skill_dir="$destination/nac-onboarding"
skill_file=$(mktemp "${TMPDIR:-/tmp}/nac-onboarding-skill.XXXXXX")
metadata_file=$(mktemp "${TMPDIR:-/tmp}/nac-onboarding-metadata.XXXXXX")
trap 'rm -f "$skill_file" "$metadata_file"' EXIT HUP INT TERM

ref=${NAC_SKILL_REF:-main}

fetch_file() {
  path=$1
  output=$2

  if command -v gh >/dev/null 2>&1 \
    && gh auth status >/dev/null 2>&1 \
    && gh api -H 'Accept: application/vnd.github.raw+json' \
      "repos/arcee-ai/nac/contents/$path?ref=$ref" > "$output" 2>/dev/null; then
    return
  fi

  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL \
      -H 'Accept: application/vnd.github.raw+json' \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      "https://api.github.com/repos/arcee-ai/nac/contents/$path?ref=$ref" \
      -o "$output"
  else
    curl -fsSL \
      "https://raw.githubusercontent.com/arcee-ai/nac/$ref/$path" \
      -o "$output"
  fi
}

fetch_file skills/nac-onboarding/SKILL.md "$skill_file"
fetch_file skills/nac-onboarding/agents/openai.yaml "$metadata_file"

# Optional integrity check for the agent skill that will be loaded and run.
# Set NAC_SKILL_CHECKSUM to the expected SHA-256 (hex) of SKILL.md. Opt-in, so
# existing installs are unaffected; a mismatch aborts before the file is moved
# into the skills directory.
if [ -n "${NAC_SKILL_CHECKSUM:-}" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$skill_file" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$skill_file" | cut -d' ' -f1)"
  else
    echo "NAC_SKILL_CHECKSUM set but neither sha256sum nor shasum is available; refusing to skip verification" >&2
    exit 1
  fi
  if [ "$actual" != "$NAC_SKILL_CHECKSUM" ]; then
    echo "skill checksum mismatch: expected $NAC_SKILL_CHECKSUM, got $actual" >&2
    exit 1
  fi
  echo "verified nac-onboarding SKILL.md checksum"
fi

mkdir -p "$skill_dir/agents"
mv "$skill_file" "$skill_dir/SKILL.md"
mv "$metadata_file" "$skill_dir/agents/openai.yaml"

printf 'Installed nac-onboarding at %s\n' "$skill_dir"
