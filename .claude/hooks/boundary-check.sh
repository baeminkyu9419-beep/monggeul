#!/usr/bin/env bash
set -euo pipefail
FILE_PATH="${CLAUDE_TOOL_USE_FILE_PATH:-${TOOL_INPUT_FILE_PATH:-}}"
[ -z "$FILE_PATH" ] && exit 0
ENFORCER="$(cd "$(dirname "$0")/../.." && pwd)/scripts/boundary-enforcer.sh"
[ -f "$ENFORCER" ] && exec bash "$ENFORCER" "${1:-write}" "$FILE_PATH"
exit 0
