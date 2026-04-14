#!/usr/bin/env bash
# violation-autofix.sh — Universal violation detect + auto-fix + record
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
RULES_FILE="$PROJECT_ROOT/data/learned-rules.json"
LOG="$PROJECT_ROOT/data/violation-autofix.log"
mkdir -p "$(dirname "$LOG")" "$(dirname "$RULES_FILE")"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
log "=== Violation Detection ==="

DETECTED=0; FIXED=0

# Architecture test
log "[1/2] Architecture test..."
if [ -f "$PROJECT_ROOT/scripts/arch-test.sh" ]; then
  if ! bash "$PROJECT_ROOT/scripts/arch-test.sh" "$PROJECT_ROOT" 2>&1 | tee -a "$LOG"; then
    DETECTED=$((DETECTED + 1))
  fi
fi

# JS/TS lint (if applicable)
if [ -f "$PROJECT_ROOT/package.json" ]; then
  log "[2/2] Lint check..."
  LINT_ERRORS=$(npx next lint 2>&1 | grep -c "Error:" 2>/dev/null || echo "0")
  if [ "$LINT_ERRORS" -gt 0 ]; then
    DETECTED=$((DETECTED + LINT_ERRORS))
    npx next lint --fix 2>&1 | tee -a "$LOG" || true
    LINT_AFTER=$(npx next lint 2>&1 | grep -c "Error:" 2>/dev/null || echo "0")
    FIXED=$((FIXED + LINT_ERRORS - LINT_AFTER))
  fi
fi

# Record
UNFIXED=$((DETECTED - FIXED))
if [ "$DETECTED" -gt 0 ]; then
  TS=$(date -Iseconds)
  ENTRY="{\"ts\":\"$TS\",\"detected\":$DETECTED,\"fixed\":$FIXED,\"unfixed\":$UNFIXED}"
  if [ -f "$RULES_FILE" ]; then
    python3 -c "
import json
try:
    with open('$RULES_FILE') as f: d=json.load(f)
except: d={'violations':[],'rules':[]}
d['violations'].append($ENTRY)
d['violations']=d['violations'][-100:]
d['last_updated']='$TS'
with open('$RULES_FILE','w') as f: json.dump(d,f,indent=2,ensure_ascii=False)
" 2>/dev/null || echo "$ENTRY" >> "$RULES_FILE"
  else
    echo "{\"violations\":[$ENTRY],\"rules\":[],\"last_updated\":\"$TS\"}" > "$RULES_FILE"
  fi
fi

# Recovery checkpoint
if [ "$UNFIXED" -gt 0 ]; then
  git stash push -m "violation-recovery-$(date +%s)" 2>/dev/null || true
fi

log "Done: $DETECTED detected, $FIXED fixed"
[ "$UNFIXED" -eq 0 ] && exit 0 || exit 1
