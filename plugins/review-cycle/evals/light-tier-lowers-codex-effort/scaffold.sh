#!/usr/bin/env bash
set -euo pipefail

# Workspace: a git repo with a tiny uncommitted change (light tier) and a codex
# shim that behaves like a working CLI — answers the Phase 1 probes, accepts
# `review`, logs its argv to $HOME (fresh per eval run, outside the repo so the
# review never sees it), and prints a clean canned review. The eval run has a
# fresh HOME, so ~/.codex/config.toml is absent and the skill's light tier must
# append -c model_reasoning_effort="low" to the review invocation.

git init -q .
cat > greet.py <<'EOF'
def greet(name):
    return "Hello, " + name
EOF
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -qm "add greet"

cat > greet.py <<'EOF'
def greet(name):
    if not name:
        name = "friend"
    return "Hello, " + name
EOF

mkdir -p .eval-bin
cat > .eval-bin/codex <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$HOME/codex-shim-argv.log"
case "${1:-}" in
  --version)
    echo "codex-cli 0.147.0 (eval shim)"
    exit 0
    ;;
  login)
    echo "Logged in using ChatGPT"
    exit 0
    ;;
  review)
    echo "Overall verdict: clean"
    echo "No findings. The uncommitted change is a small, correct fallback."
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x .eval-bin/codex
export PATH="$PWD/.eval-bin:$PATH"
