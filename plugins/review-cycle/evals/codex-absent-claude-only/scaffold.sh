#!/usr/bin/env bash
set -euo pipefail

# Workspace: a git repo with one small uncommitted change (light tier), and a
# codex shim that exits 127 — the exit code the skill's Phase 1 probe must read
# as "not installed". The host's real codex stays shadowed for the whole run.

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

mkdir -p .eval-bin
cat > .eval-bin/codex <<'EOF'
#!/usr/bin/env bash
exit 127
EOF
chmod +x .eval-bin/codex
export PATH="$PWD/.eval-bin:$PATH"
