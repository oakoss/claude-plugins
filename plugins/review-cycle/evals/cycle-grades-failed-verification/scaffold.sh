#!/usr/bin/env bash
set -euo pipefail

# Workspace: a git repo with a tiny uncommitted change (light tier) and a codex
# shim whose canned review logs two commands the way codex-cli 0.162.1 does,
# one that succeeded and one that exited 1, and whose verdict carries no
# receipt lines. The skill builds Codex's receipt from that log, and Phase 4's
# table grades it partial, so the summary must label the Codex leg partial,
# naming what failed.

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

# The shim lives in the eval HOME, outside the reviewed repo. This script's
# environment never reaches the session, and case.yaml may set only EVAL_*
# variables, so the shell rc files the session sources put it on PATH.
mkdir -p "$HOME/.eval-bin"
cat > "$HOME/.eval-bin/codex" <<'EOF'
#!/usr/bin/env bash
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
    e=$(printf '\033')
    printf '%s\n' "OpenAI Codex v0.147.0 (eval shim)" "--------"
    printf '%s\n' "${e}[35m${e}[3mexec${e}[0m${e}[0m"
    printf '%s\n' "${e}[1m/bin/zsh -lc \"python3 -c 'import greet; print(greet.greet(None))'\"${e}[0m in $PWD"
    printf '%s\n' "${e}[32m succeeded in 41ms:${e}[0m" "Hello, friend" ""
    printf '%s\n' "${e}[35m${e}[3mexec${e}[0m${e}[0m"
    printf '%s\n' "${e}[1m/bin/zsh -lc 'python3 -m pytest'${e}[0m in $PWD"
    printf '%s\n' "${e}[31m exited 1 in 38ms:${e}[0m" "/usr/bin/python3: No module named pytest" ""
    printf '%s\n' "${e}[35m${e}[3mcodex${e}[0m${e}[0m"
    echo "Overall verdict: clean"
    echo "No findings. The uncommitted change is a small, correct fallback."
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$HOME/.eval-bin/codex"
for rc in .zshenv .zprofile .zshrc .bashrc .bash_profile; do
  printf 'export PATH="%s:$PATH"\n' "$HOME/.eval-bin" >> "$HOME/$rc"
done
