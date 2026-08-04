#!/bin/sh

set -eu

# Keep backups private: the NAC store contains conversation history.
umask 077

keep="${NAC_STORE_BACKUP_KEEP:-5}"
case "$keep" in
  ''|*[!0-9]*)
    echo "NAC_STORE_BACKUP_KEEP must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$keep" -lt 1 ]; then
  echo "NAC_STORE_BACKUP_KEEP must be at least 1" >&2
  exit 1
fi

if [ -n "${NAC_STORE_PATH:-}" ]; then
  store_path="$NAC_STORE_PATH"
elif [ -n "${NAC_HOME:-}" ]; then
  store_path="$NAC_HOME/store.db"
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
  store_path="$XDG_CONFIG_HOME/nac/store.db"
else
  store_path="${HOME:?HOME is required}/.config/nac/store.db"
fi

if [ ! -f "$store_path" ]; then
  echo "NAC store does not exist; no backup needed: $store_path"
  exit 0
fi

backup_dir="${NAC_STORE_BACKUP_DIR:-$(dirname "$store_path")/backups}"
manifest="$backup_dir/manifest.tsv"
reason="${1:-manual}"
reason=$(printf '%s' "$reason" | tr '\t\r\n' '   ')

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
git_head=$(git rev-parse --short=12 HEAD 2>/dev/null || printf '%s' no-git)
temp_dir=$(mktemp -d "$backup_dir/.backup.XXXXXX")
temp_path="$temp_dir/store.db"

cleanup() {
  if [ -n "${temp_path:-}" ] && [ -f "$temp_path" ]; then
    rm -f -- "$temp_path"
  fi
  if [ -n "${temp_dir:-}" ] && [ -d "$temp_dir" ]; then
    rmdir "$temp_dir" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

# SQLite's online backup operation includes committed WAL contents and is safe
# while nac-web is running.
sqlite3 "$store_path" ".timeout 10000" ".backup \"$temp_path\""

integrity=$(sqlite3 "$temp_path" 'PRAGMA integrity_check;')
if [ "$integrity" != "ok" ]; then
  echo "NAC store backup failed integrity check: $integrity" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  digest=$(shasum -a 256 "$temp_path" | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$temp_path" | awk '{print $1}')
else
  echo "shasum or sha256sum is required to deduplicate backups" >&2
  exit 1
fi

latest=$(
  for candidate in "$backup_dir"/store-*.db; do
    [ -f "$candidate" ] && printf '%s\n' "$candidate"
  done | LC_ALL=C sort | tail -n 1
)
if [ -n "$latest" ]; then
  if command -v shasum >/dev/null 2>&1; then
    latest_digest=$(shasum -a 256 "$latest" | awk '{print $1}')
  else
    latest_digest=$(sha256sum "$latest" | awk '{print $1}')
  fi
else
  latest_digest=""
fi

if [ -n "$latest" ] && [ "$digest" = "$latest_digest" ]; then
  selected=$(basename "$latest")
  action="reused"
  rm -f -- "$temp_path"
  temp_path=""
else
  selected="store-$timestamp-$git_head-$$.db"
  final_path="$backup_dir/$selected"
  mv "$temp_path" "$final_path"
  chmod 600 "$final_path"
  temp_path=""
  action="created"

  if [ ! -f "$manifest" ]; then
    printf 'created_utc\tgit_head\treason\tfilename\tsha256\n' > "$manifest"
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$timestamp" "$git_head" "$reason" "$selected" "$digest" >> "$manifest"
fi

# Keep only the newest configured number of database copies.
for candidate in "$backup_dir"/store-*.db; do
  [ -f "$candidate" ] && printf '%s\n' "$candidate"
done \
  | LC_ALL=C sort -r \
  | sed -n "$((keep + 1)),\$p" \
  | while IFS= read -r old_backup; do
    [ -n "$old_backup" ] && rm -f -- "$old_backup"
  done

# The manifest describes files that still exist, rather than accumulating an
# unbounded audit log of already-rotated copies.
manifest_next="$temp_dir/manifest.tsv"
printf 'created_utc\tgit_head\treason\tfilename\tsha256\n' > "$manifest_next"
if [ -f "$manifest" ]; then
  tail -n +2 "$manifest" | while IFS="$(printf '\t')" read -r created head entry_reason filename entry_digest; do
    if [ -n "$filename" ] && [ -f "$backup_dir/$filename" ]; then
      printf '%s\t%s\t%s\t%s\t%s\n' \
        "$created" "$head" "$entry_reason" "$filename" "$entry_digest"
    fi
  done >> "$manifest_next"
fi
mv "$manifest_next" "$manifest"
chmod 600 "$manifest"

echo "NAC store backup $action: $backup_dir/$selected (retaining $keep)"
