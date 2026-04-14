#!/usr/bin/env bash
# post-bash-check.sh — PostToolUse Bash audit (universal)
set -uo pipefail
PROJECT_ROOT="${PROJECT_ROOT:-.}"
LOG="$PROJECT_ROOT/data/bash-audit.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
CMD="${CLAUDE_TOOL_USE_COMMAND:-}"
[ -z "$CMD" ] && exit 0
echo "$(date -Iseconds) $CMD" >> "$LOG" 2>/dev/null || true
if echo "$CMD" | grep -qiE "rm\s+-rf|git\s+(reset|clean|push\s+--force)"; then
  echo "[WARN] Destructive operation: $CMD"
fi
exit 0
