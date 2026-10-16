#!/usr/bin/env bash
set -euo pipefail

# Workspace: a git repo with one small uncommitted change for the reviewer to
# read. No Codex shim: this case never runs the review skill.

git init -q .
cat > slugify.py <<'EOF'
import re


def slugify(text):
    text = text.lower().strip()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")
EOF
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -qm "add slugify"

cat > slugify.py <<'EOF'
import re


def slugify(text, sep="-"):
    text = text.lower().strip()
    return re.sub(r"[^a-z0-9]+", sep, text).strip(sep)
EOF
