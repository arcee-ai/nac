#!/usr/bin/env bash
set -euo pipefail

readonly source_branch="release-preparation-source"
readonly release_branch="release-please--branches--${source_branch}--components--nac"

usage() {
  echo "usage: $0 stage|finalize" >&2
  exit 2
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 2
  fi
}

dev_sha() {
  gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/dev" --jq .object.sha
}

require_selected_dev() {
  local current
  current="$(dev_sha)"
  if [ "$current" != "$SOURCE_SHA" ]; then
    echo "selected source $SOURCE_SHA is not the current dev tip $current" >&2
    return 1
  fi
}

open_release_pr_count() {
  gh api --method GET "repos/$GITHUB_REPOSITORY/pulls" \
    -f state=open \
    -f "head=${GITHUB_REPOSITORY_OWNER}:$release_branch" \
    --jq length
}

open_release_pr_field() {
  local field="$1"
  gh api --method GET "repos/$GITHUB_REPOSITORY/pulls" \
    -f state=open \
    -f "head=${GITHUB_REPOSITORY_OWNER}:$release_branch" \
    --jq ".[0].$field // empty"
}

retarget_pr() {
  local number="$1"
  local base="$2"
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/pulls/$number" \
    -f base="$base" \
    --silent
}

stage() {
  require_selected_dev

  if gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$source_branch" --silent; then
    gh api --method PATCH "repos/$GITHUB_REPOSITORY/git/refs/heads/$source_branch" \
      -f sha="$SOURCE_SHA" \
      -F force=true \
      --silent
  else
    gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs" \
      -f "ref=refs/heads/$source_branch" \
      -f sha="$SOURCE_SHA" \
      --silent
  fi

  local bound_sha
  bound_sha="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$source_branch" --jq .object.sha)"
  if [ "$bound_sha" != "$SOURCE_SHA" ]; then
    echo "preparation source branch resolved to $bound_sha instead of $SOURCE_SHA" >&2
    exit 1
  fi

  local count
  count="$(open_release_pr_count)"
  if [ "$count" -gt 1 ]; then
    echo "found $count open release preparation pull requests" >&2
    exit 1
  fi
  if [ "$count" -eq 1 ]; then
    local number base
    number="$(open_release_pr_field number)"
    base="$(open_release_pr_field base.ref)"
    case "$base" in
      dev) retarget_pr "$number" "$source_branch" ;;
      "$source_branch") ;;
      *)
        echo "release preparation pull request #$number has unexpected base $base" >&2
        exit 1
        ;;
    esac
  fi
}

finalize() {
  require_selected_dev

  local count
  count="$(open_release_pr_count)"
  if [ "$count" -ne 1 ]; then
    echo "expected exactly one open release preparation pull request, found $count" >&2
    exit 1
  fi

  local number base files
  number="$(open_release_pr_field number)"
  base="$(open_release_pr_field base.ref)"
  if [ "$base" != "$source_branch" ]; then
    echo "release preparation pull request #$number has unexpected base $base" >&2
    exit 1
  fi

  files="$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$number/files" --jq '.[].filename')"
  for required in .release-please-manifest.json CHANGELOG.md version.txt; do
    if ! grep -Fxq "$required" <<<"$files"; then
      echo "release preparation pull request #$number is missing $required" >&2
      exit 1
    fi
  done

  retarget_pr "$number" dev
  if ! require_selected_dev; then
    retarget_pr "$number" "$source_branch"
    echo "dev changed while finalizing release preparation; pull request returned to $source_branch" >&2
    exit 1
  fi

  base="$(open_release_pr_field base.ref)"
  if [ "$base" != dev ]; then
    echo "release preparation pull request #$number did not retarget to dev" >&2
    exit 1
  fi
  echo "prepared https://github.com/$GITHUB_REPOSITORY/pull/$number from $SOURCE_SHA"
}

require_env GH_TOKEN
require_env GITHUB_REPOSITORY
require_env GITHUB_REPOSITORY_OWNER
require_env SOURCE_SHA
if ! [[ "$SOURCE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "SOURCE_SHA must be a full commit SHA" >&2
  exit 2
fi
SOURCE_SHA="$(printf '%s' "$SOURCE_SHA" | tr 'A-F' 'a-f')"

case "${1:-}" in
  stage) stage ;;
  finalize) finalize ;;
  *) usage ;;
esac
