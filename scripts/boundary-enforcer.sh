#!/usr/bin/env bash
# boundary-enforcer.sh — Universal file/API/DB permission boundary enforcer
# Usage: bash boundary-enforcer.sh <operation> <target>
# Exit 0 = allowed, Exit 1 = blocked
set -euo pipefail

OPERATION="${1:-}"
TARGET="${2:-}"

check_file_permission() {
  local file="$1" op="$2"

  # .env files: never write directly
  if [[ "$file" == *".env"* ]] && [[ "$op" == "write" ]]; then
    echo "BLOCKED: Cannot write .env directly. Use secrets.env → sync."
    exit 1
  fi

  # .git internals: never write
  if [[ "$file" == *".git/"* ]] && [[ "$op" == "write" ]]; then
    echo "BLOCKED: Cannot write to .git internals."
    exit 1
  fi

  # Config files: worker lanes read-only
  if [[ "$file" == *"config/"* || "$file" == *".eslintrc"* || "$file" == *"tsconfig"* || "$file" == *"next.config"* || "$file" == *"tailwind.config"* || "$file" == *"package.json"* || "$file" == *"pyproject.toml"* || "$file" == *"requirements.txt"* ]]; then
    if [[ "$op" == "write" ]] && [[ "${PROJECT_LANE:-Main}" != "Main" ]]; then
      echo "BLOCKED: Config files are read-only for worker lanes."
      exit 1
    fi
  fi

  # .mother/shared: Main only
  if [[ "$file" == *".mother/shared/"* ]] && [[ "$op" == "write" ]] && [[ "${PROJECT_LANE:-Main}" != "Main" ]]; then
    echo "BLOCKED: .mother/shared/ is Main-only."
    exit 1
  fi

  # EVOLUTION.md: Main only
  if [[ "$file" == *"EVOLUTION.md"* ]] && [[ "$op" == "write" ]] && [[ "${PROJECT_LANE:-Main}" != "Main" ]]; then
    echo "BLOCKED: EVOLUTION.md is Main-only."
    exit 1
  fi

  exit 0
}

check_db_permission() {
  local sql_upper=$(echo "$1" | tr '[:lower:]' '[:upper:]')
  for pattern in "DROP\s\+TABLE" "DROP\s\+DATABASE" "TRUNCATE\s\+TABLE" "GRANT" "REVOKE"; do
    if echo "$sql_upper" | grep -qE "$pattern"; then
      echo "BLOCKED: $pattern forbidden."
      exit 1
    fi
  done
  if echo "$sql_upper" | grep -qE "DELETE\s+FROM\s+\w+\s*$"; then
    echo "BLOCKED: DELETE without WHERE forbidden."
    exit 1
  fi
  exit 0
}

check_api_permission() {
  local url="$1"
  if [[ "$url" == *"localhost"* || "$url" == *"127.0.0.1"* || "$url" == "/api/"* ]]; then exit 0; fi
  if [[ "$url" == *"api.github.com"* || "$url" == *"vercel.com"* || "$url" == *"supabase.co"* || "$url" == *"railway.app"* ]]; then exit 0; fi
  echo "WARNING: External API call — $url" >> "${PROJECT_ROOT:-.}/data/boundary-audit.log" 2>/dev/null || true
  exit 0
}

case "$OPERATION" in
  read|write|execute) check_file_permission "$TARGET" "$OPERATION" ;;
  api-call) check_api_permission "$TARGET" ;;
  db-query) check_db_permission "$TARGET" ;;
  *) exit 0 ;;
esac
