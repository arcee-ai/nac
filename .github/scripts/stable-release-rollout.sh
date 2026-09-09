#!/bin/sh
set -eu

usage() {
  echo "usage: $0 --check|--apply [owner/repository]" >&2
  exit 2
}

mode=${1:-}
repository=${2:-arcee-ai/nac}
case "$mode" in
  --check|--apply) ;;
  *) usage ;;
esac

case "$repository" in
  */*) ;;
  *) usage ;;
esac

stable_path=$(gh api \
  "repos/$repository/contents/.github/workflows/stable-release.yml?ref=dev" \
  --jq .path)
test "$stable_path" = ".github/workflows/stable-release.yml"

legacy_id=$(gh api "repos/$repository/actions/workflows/release.yml" --jq .id)
legacy_state=$(gh api "repos/$repository/actions/workflows/$legacy_id" --jq .state)

if [ "$mode" = "--apply" ] && [ "$legacy_state" != "disabled_manually" ]; then
  gh api --method PUT "repos/$repository/actions/workflows/$legacy_id/disable" >/dev/null
  legacy_state=$(gh api "repos/$repository/actions/workflows/$legacy_id" --jq .state)
fi

if [ "$legacy_state" != "disabled_manually" ]; then
  echo "legacy .github/workflows/release.yml is $legacy_state; rerun with --apply before enabling Release Please" >&2
  exit 1
fi

echo "stable-release.yml exists on dev and legacy release.yml is disabled"
