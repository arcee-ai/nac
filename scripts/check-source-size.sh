#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
default_limit=2000
maximum_exception_limit=3000
checked_files=0
violations=0

is_machine_written() {
    case "$1" in
        Cargo.lock | */package-lock.json | \
            crates/nac-server/web/openapi.json | \
            crates/nac-server/web/src/app/types/openapi.generated.ts | \
            crates/nac-server/web/src/app/atoms/file-icon/manifest.generated.ts | \
            crates/nac-server/assets/dist/* | \
            crates/nac-core/src/model/catalog/data/catalog.json | \
            crates/nac-core/src/model/catalog/data/catalog.manifest.json | \
            crates/nac-catalog-gen/fixtures/*)
            return 0
            ;;
    esac
    return 1
}

is_human_source() {
    case "$1" in
        Makefile | */Makefile | Dockerfile | */Dockerfile | \
            *.rs | *.ts | *.tsx | *.js | *.jsx | *.css | *.scss | *.html | \
            *.sh | *.bash | *.py | *.toml | *.md | *.yml | *.yaml | *.json | \
            *.sql | *.graphql | *.xml | *.svg | *.txt)
            return 0
            ;;
    esac
    return 1
}

while IFS= read -r -d '' tracked_file; do
    is_human_source "$tracked_file" || continue
    is_machine_written "$tracked_file" && continue

    limit=$default_limit
    exception_reason=
    case "$tracked_file" in
        # A future cohesive exception must set both a limit no greater than
        # maximum_exception_limit and a durable ownership reason. Keep this
        # list empty unless splitting would make an invariant harder to audit.
        *) ;;
    esac

    if ((limit > maximum_exception_limit)); then
        printf 'error: internal source-size policy for %s exceeds the %d-line exception ceiling\n' \
            "$tracked_file" "$maximum_exception_limit" >&2
        violations=$((violations + 1))
        continue
    fi
    if ((limit > default_limit)) && [[ -z "$exception_reason" ]]; then
        printf 'error: source-size exception for %s has no ownership reason\n' \
            "$tracked_file" >&2
        violations=$((violations + 1))
        continue
    fi

    line_count=$(awk 'END { print NR }' "$repository_root/$tracked_file")
    checked_files=$((checked_files + 1))
    if ((line_count > limit)); then
        printf 'error: %s has %d lines (limit %d)\n' \
            "$tracked_file" "$line_count" "$limit" >&2
        if [[ -n "$exception_reason" ]]; then
            printf '       documented exception: %s\n' "$exception_reason" >&2
        else
            printf '%s\n' \
                '       split it at an ownership seam; do not create arbitrary fragments' >&2
        fi
        violations=$((violations + 1))
    fi
done < <(git -C "$repository_root" ls-files -z)

if ((violations > 0)); then
    printf 'source size check: %d violation(s) across %d checked files\n' \
        "$violations" "$checked_files" >&2
    exit 1
fi

printf 'source size check: ok (%d tracked human-source files, %d-line limit)\n' \
    "$checked_files" "$default_limit"
