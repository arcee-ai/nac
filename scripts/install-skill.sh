#!/bin/sh
# Install nac's onboarding skill for a chosen agent runtime.
set -eu

usage() {
  cat <<'EOF'
Usage: install-skill.sh [--target TARGET]

Targets: auto, agents, nac, codex, claude, opencode, project
  auto     Install into ~/.agents/skills (the cross-agent default).
  agents   Install into ~/.agents/skills.
  nac      Install into $NAC_HOME/skills or ~/.config/nac/skills.
  codex    Install into $CODEX_HOME/skills or ~/.codex/skills.
  claude   Install into $CLAUDE_CONFIG_DIR/skills or ~/.claude/skills.
  opencode Install into $XDG_CONFIG_HOME/opencode/skills or ~/.config/opencode/skills.
  project  Install into ./.agents/skills in the current project.
EOF
}

target=auto
if [ "${1:-}" = "--target" ]; then
  if [ "$#" -ne 2 ]; then
    usage >&2
    exit 2
  fi
  target="${2:-}"
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
elif [ "$#" -ne 0 ]; then
  usage >&2
  exit 2
fi

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

skill_dir="$destination/nac-onboarding"
mkdir -p "$skill_dir"
temp_file=$(mktemp "${TMPDIR:-/tmp}/nac-onboarding.XXXXXX")
trap 'rm -f "$temp_file"' EXIT HUP INT TERM

curl -fsSL \
  https://raw.githubusercontent.com/arcee-ai/nac/main/skills/nac-onboarding/SKILL.md \
  -o "$temp_file"
mv "$temp_file" "$skill_dir/SKILL.md"

printf 'Installed nac-onboarding at %s\n' "$skill_dir"
