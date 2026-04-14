#!/usr/bin/env bash
# intent-classifier.sh — UserPromptSubmit hook (universal)
set -uo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-.}"
STATE_FILE="$PROJECT_ROOT/data/session_intent.json"
mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true

PROMPT="${CLAUDE_USER_PROMPT:-}"
[ -z "$PROMPT" ] && exit 0

INTENT="CODE_CHANGE"; CONFIDENCE=50

for p in "뭐야|뭔지|알려줘|설명|어떻게|무슨|보여줘|확인해|찾아봐" "what is|show me|explain|how does|check|find|list|display|describe" "현재 상태|현황|점검|audit|status|review" "읽어|읽기|read|look at|view"; do
  if echo "$PROMPT" | grep -qiE "$p"; then INTENT="READ_ONLY"; CONFIDENCE=75; break; fi
done

for p in "만들어|작성|추가|수정|삭제|변경|구현|생성|리팩토링" "create|write|add|fix|modify|delete|implement|build|refactor|install" "진행해|진행하세요|해줘|해주세요|시작"; do
  if echo "$PROMPT" | grep -qiE "$p"; then INTENT="CODE_CHANGE"; CONFIDENCE=85; break; fi
done

cat > "$STATE_FILE" << EOF
{"intent":"$INTENT","confidence":$CONFIDENCE,"ts":"$(date -Iseconds)"}
EOF
exit 0
