#!/usr/bin/env bash
# arch-test.sh — Universal architecture boundary tests
# Works for: Next.js, Python/FastAPI, Vite, any project
# Exit 1 on any violation.
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
VIOLATIONS=0

echo "=== Architecture Boundary Tests ==="

# Detect project type
HAS_JS=false; HAS_PY=false
[ -d "$PROJECT_ROOT/src" ] && HAS_JS=true
[ -f "$PROJECT_ROOT/requirements.txt" ] || [ -f "$PROJECT_ROOT/pyproject.toml" ] && HAS_PY=true
[ -f "$PROJECT_ROOT/package.json" ] && HAS_JS=true

# ─── Universal Rules ───

# U-001: No hardcoded secrets
echo -n "[U-001] No hardcoded API keys... "
if grep -rn "sk-[a-zA-Z0-9]\{20,\}\|AKIA[A-Z0-9]\{16\}\|ghp_[a-zA-Z0-9]\{36\}" "$PROJECT_ROOT/src/" "$PROJECT_ROOT/app/" "$PROJECT_ROOT/lib/" 2>/dev/null | grep -v node_modules | grep -v ".env"; then
  echo "FAIL"; VIOLATIONS=$((VIOLATIONS + 1))
else
  echo "PASS"
fi

# U-002: No eval() in any language
echo -n "[U-002] No eval/exec... "
EVAL_HITS=""
if [ "$HAS_JS" = true ]; then
  EVAL_HITS=$(grep -rn "\beval\s*(" "$PROJECT_ROOT/src/" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" 2>/dev/null | grep -v node_modules || true)
fi
if [ "$HAS_PY" = true ]; then
  EVAL_HITS="$EVAL_HITS$(grep -rn "\beval\s*(\|exec\s*(" "$PROJECT_ROOT/" --include="*.py" 2>/dev/null | grep -v __pycache__ | grep -v ".venv" | grep -v "node_modules" || true)"
fi
if [ -n "$EVAL_HITS" ]; then
  echo "FAIL"; echo "$EVAL_HITS"; VIOLATIONS=$((VIOLATIONS + 1))
else
  echo "PASS"
fi

# U-003: No destructive SQL
echo -n "[U-003] No destructive SQL... "
if grep -rni "DROP\s\+TABLE\|DROP\s\+DATABASE\|TRUNCATE\s\+TABLE" "$PROJECT_ROOT/src/" "$PROJECT_ROOT/app/" "$PROJECT_ROOT/lib/" "$PROJECT_ROOT/backend/" 2>/dev/null | grep -v node_modules | grep -v migrations | grep -v __pycache__; then
  echo "FAIL"; VIOLATIONS=$((VIOLATIONS + 1))
else
  echo "PASS"
fi

# ─── JS/TS Rules (if applicable) ───
if [ "$HAS_JS" = true ] && [ -d "$PROJECT_ROOT/src" ]; then

  # JS-001: No DB imports in frontend components
  echo -n "[JS-001] No DB imports in components... "
  if grep -rn "from ['\"]\\(pg\\|mysql2\\|mongoose\\|@prisma/client\\|knex\\|typeorm\\|drizzle\\|better-sqlite3\\)" "$PROJECT_ROOT/src/components/" "$PROJECT_ROOT/src/app/" 2>/dev/null | grep -v "/api/" | grep -v node_modules; then
    echo "FAIL"; VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "PASS"
  fi

  # JS-002: No Node builtins in client code
  echo -n "[JS-002] No Node builtins in client... "
  if grep -rn "require(['\"]\\(fs\\|child_process\\|path\\|os\\)['\"])" "$PROJECT_ROOT/src/components/" --include="*.ts" --include="*.tsx" 2>/dev/null; then
    echo "FAIL"; VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "PASS"
  fi
fi

# ─── Python Rules (if applicable) ───
if [ "$HAS_PY" = true ]; then

  # PY-001: No os.system / subprocess with shell=True in web handlers
  echo -n "[PY-001] No shell=True in web handlers... "
  if grep -rn "shell=True\|os\.system(" "$PROJECT_ROOT/" --include="*route*.py" --include="*endpoint*.py" --include="*api*.py" --include="*server*.py" 2>/dev/null | grep -v __pycache__ | grep -v ".venv"; then
    echo "FAIL"; VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "PASS"
  fi

  # PY-002: No pickle.loads on untrusted data patterns
  echo -n "[PY-002] No pickle.loads in web code... "
  if grep -rn "pickle\.loads\|pickle\.load(" "$PROJECT_ROOT/" --include="*route*.py" --include="*api*.py" --include="*server*.py" 2>/dev/null | grep -v __pycache__ | grep -v ".venv"; then
    echo "FAIL"; VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "PASS"
  fi
fi

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "FAILED: $VIOLATIONS violation(s)."
  exit 1
else
  echo "ALL PASSED."
  exit 0
fi
