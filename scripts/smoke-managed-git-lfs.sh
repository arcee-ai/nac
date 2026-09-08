#!/bin/sh
set -eu

# Exercise the Git LFS runtime contract as the managed user without network
# access. The fixture lives on the executable repository mount because /tmp is
# intentionally noexec during the managed-image smoke.
git lfs version
test "$(git config --system --get filter.lfs.required)" = true
test "$(git config --system --get filter.lfs.clean)" = 'git-lfs clean -- %f'
test "$(git config --system --get filter.lfs.smudge)" = 'git-lfs smudge -- %f'
test "$(git config --system --get filter.lfs.process)" = 'git-lfs filter-process'

fixture=$(mktemp -d "${LFS_SMOKE_ROOT:-/repositories}/nac-lfs-smoke.XXXXXX")
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
git init --bare --quiet "$fixture/remote.git"
git init --quiet "$fixture/source"
cd "$fixture/source"
git config user.name 'Managed image smoke'
git config user.email 'managed-smoke@example.test'
git lfs track '*.bin'
printf '%s\n' 'managed tokenizer LFS payload' > tokenizer.bin
git add .gitattributes tokenizer.bin
git commit --quiet -m 'LFS fixture'

# Prove the Git object is an LFS pointer before exercising transfer/smudge.
git show HEAD:tokenizer.bin | grep -Fx 'version https://git-lfs.github.com/spec/v1'
git remote add origin "$fixture/remote.git"
git push --quiet origin HEAD:refs/heads/main
git --git-dir="$fixture/remote.git" symbolic-ref HEAD refs/heads/main

# The independent clone has no local LFS object cache, so checkout must fetch
# and smudge the payload through the configured system filters.
git clone --quiet "$fixture/remote.git" "$fixture/clone"
cmp tokenizer.bin "$fixture/clone/tokenizer.bin"
cd "$fixture/clone"
git lfs fsck
printf '%s\n' 'managed Git LFS smoke: ok'
