#!/usr/bin/env bash
# Copies a repository's working tree into a new directory a reviewer leg can
# run the project's checks in without writing to the repository.
# Usage: copy-tree.sh <repo> <dest> [<checkout to take node_modules from>]
set -euo pipefail

usage='usage: copy-tree.sh <repo> <dest> [<checkout to take node_modules from>]'
repo=${1:?$usage}
dest=${2:?$usage}
repo=$(cd "$repo" && git rev-parse --show-toplevel)
modules=$(cd "${3:-$repo}" && pwd -P)
mkdir "$dest"
dest=$(cd "$dest" && pwd -P)
# A partial copy looks like a usable one, so a failure removes it.
trap 'rm -rf "${dest:?}"' EXIT

# The working tree as it stands: tracked and untracked files git does not
# ignore, less tracked files deleted from it. A submodule comes without its
# .git, which points into the repository's own.
cd "$repo"
git ls-files -co --exclude-standard -z \
  | while IFS= read -r -d '' f; do
    if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi
  done \
  | tar --null -T - --exclude .git -cf - \
  | tar -xpf - -C "$dest"

# Its own git directory, reading the repository's objects through alternates,
# so git in the copy writes only to the copy, a worktree's included. A copied
# .git would not do: a worktree's is a file naming the repository's.
git clone -q --shared --no-checkout "$repo" "$dest/.clone"
mv "$dest/.clone/.git" "$dest/.git"
rmdir "$dest/.clone"
git -C "$dest" remote remove origin
git -C "$dest" update-ref --no-deref HEAD "$(git rev-parse HEAD)"
# Branches and remote-tracking refs, so a base such as origin/main resolves.
git -C "$dest" fetch -q "$repo" '+refs/heads/*:refs/heads/*' '+refs/remotes/*:refs/remotes/*'
index=$(git rev-parse --path-format=absolute --git-path index)
cp "$index" "$dest/.git/index"
# A split index names a shared index kept beside it.
for s in "${index%/index}"/sharedindex.*; do
  if [ -e "$s" ]; then cp "$s" "$dest/.git/"; fi
done
while IFS= read -r -d '' e; do
  if [ "${e%% *}" = 160000 ] && [ -e "${e#*$'\t'}/.git" ]; then
    echo "copy-tree: ${e#*$'\t'} is a submodule, copied without its git directory: changes inside it do not show in the copy's git status" >&2
  fi
done < <(git ls-files -s -z)

# Every node_modules copied, cloned where the filesystem can. Links into the
# repository's would let an install in the copy rewrite the repository's
# packages: measured, pnpm rewrote 83 of them before refusing. Links inside
# node_modules are copied as they are, so one that points outside the copy, as
# npm link and pnpm's link: make, still points there. The probe sits in the
# copy's own .git, where no project file can be.
clone=()
printf x >"$dest/.git/probe"
if cp --reflink=auto "$dest/.git/probe" "$dest/.git/probe-c" 2>/dev/null; then
  clone=(--reflink=auto)
elif cp -c "$dest/.git/probe" "$dest/.git/probe-c" 2>/dev/null; then
  clone=(-c)
fi
rm -f "$dest/.git/probe" "$dest/.git/probe-c"
cd "$modules"
found=$(find . -path ./.git -prune -o -name node_modules -type d -prune -print)
if [ -z "$found" ] && [ -e package.json ]; then
  echo "copy-tree: no node_modules under $modules, so the copy has none" >&2
fi
printf '%s\n' "$found" \
  | while IFS= read -r nm; do
    [ -n "$nm" ] || continue
    mkdir -p "$dest/$nm"
    cp ${clone[@]+"${clone[@]}"} -RP "$nm/." "$dest/$nm"
  done

trap - EXIT
echo "$dest"
