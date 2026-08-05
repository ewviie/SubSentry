#!/bin/sh
# Run once after cloning: wires this repo's pre-commit secret scan into
# your local git hooks. `.git/hooks/` isn't itself version-controlled (git
# has no way to auto-install a hook on clone without a package-manager
# hook like husky, which this repo deliberately doesn't add as a new
# dependency for one script) — this is the manual equivalent.
set -e

# `git rev-parse --git-dir`/hooks assumes the default hooks location — if
# the user (or another tool) has configured core.hooksPath, that's where
# Git actually looks, and installing into the default location would
# silently do nothing. `git rev-parse --git-path hooks` resolves the real
# path either way.
hooks_dir="$(git rev-parse --git-path hooks)"
mkdir -p "$hooks_dir"
target="$hooks_dir/pre-commit"

# Don't clobber a hook that isn't ours — a project (or the user) may
# already have a pre-commit hook doing something else; overwriting it
# silently would delete that behavior with no way to recover it.
if [ -e "$target" ] && ! grep -q "gitleaks" "$target" 2>/dev/null; then
  echo "✗ $target already exists and doesn't look like this script's hook. Not overwriting it." >&2
  echo "  Merge scripts/git-hooks/pre-commit into it by hand, or move the existing hook aside first." >&2
  exit 1
fi

cp "$(dirname "$0")/git-hooks/pre-commit" "$target"
chmod +x "$target"
echo "✓ Pre-commit secret scan installed at $target. Requires gitleaks: https://github.com/gitleaks/gitleaks#installing"
