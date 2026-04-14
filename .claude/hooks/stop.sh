#!/bin/bash
# MONGGEUL Stop Hook — 세션 종료 시 자동 보호
# 커밋 → push → 백업 → QA → 세션기록

PROJECT_DIR="/c/JARVIS_NEW/projects/MONGGEUL"
BRANCH="main"

# 마더 공용 파이프라인 실행
bash /c/JARVIS_NEW/runtime/mother_root/hooks/stop_pipeline.sh "$PROJECT_DIR" "$BRANCH"
