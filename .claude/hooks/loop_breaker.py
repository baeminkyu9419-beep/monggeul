#!/usr/bin/env python3
"""
ONGLE Loop Breaker — bkit 개념 기반 온글 전용 재설계
Claude Code PreToolUse 훅으로 동작. 4가지 규칙으로 반복 작업 감지/차단.

규칙:
  LB-001  동일 파일 반복 편집   warn=7  max=10  → pause
  LB-002  에러 반복 재시도       warn=2  max=3   → pause
  LB-003  파이프라인 단계 반복   warn=3  max=5   → abort
  LB-004  에이전트 재귀          warn=2  max=3   → abort

stdin: Claude Code PreToolUse JSON
stdout: {"decision":"block","reason":"..."} 또는 빈 출력(허용)
"""

import json
import sys
import os
import time
import io

# Windows cp949 인코딩 문제 방지
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# ── 설정 ──
STATE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "loop_breaker_state.json"
)

RULES = {
    "LB-001": {
        "name": "동일 파일 반복 편집",
        "warn_at": 7,
        "max_count": 10,
        "action": "pause",  # 경고 후 사용자 판단 유도
    },
    "LB-002": {
        "name": "에러 반복 재시도",
        "warn_at": 2,
        "max_count": 3,
        "action": "pause",
    },
    "LB-003": {
        "name": "파이프라인 단계 반복",
        "warn_at": 3,
        "max_count": 5,
        "action": "abort",  # 즉시 차단
    },
    "LB-004": {
        "name": "에이전트 재귀",
        "warn_at": 2,
        "max_count": 3,
        "action": "abort",
    },
}


def load_state():
    """상태 파일 로드. 없으면 초기 상태 반환."""
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return new_state()


def new_state():
    return {
        "session_id": time.strftime("%Y%m%d_%H%M%S"),
        "file_edits": {},      # LB-001: {filepath: count}
        "error_retries": {},   # LB-002: {error_sig: count}
        "pipeline_steps": {},  # LB-003: {step_key: count}
        "agent_stack": [],     # LB-004: [agent_name, ...]
        "warnings_issued": [], # 발행된 경고 목록
        "blocks_issued": [],   # 차단된 작업 목록
    }


def save_state(state):
    """상태 파일 원자적 저장."""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_FILE)


def check_file_edit(state, file_path):
    """LB-001: 동일 파일 반복 편집 감지."""
    if not file_path:
        return None

    # 카운터 증가
    count = state["file_edits"].get(file_path, 0) + 1
    state["file_edits"][file_path] = count

    rule = RULES["LB-001"]
    short = os.path.basename(file_path)

    if count >= rule["max_count"]:
        return {
            "rule": "LB-001",
            "action": rule["action"],
            "message": f"⛔ [{rule['name']}] {short} → {count}회 편집 (한계 {rule['max_count']}회). "
                       f"같은 파일을 반복 수정 중입니다. 접근 방식을 바꾸세요.",
            "count": count,
        }
    elif count >= rule["warn_at"]:
        return {
            "rule": "LB-001",
            "action": "warn",
            "message": f"⚠️ [{rule['name']}] {short} → {count}/{rule['max_count']}회. "
                       f"반복 편집 감지. 근본 원인을 점검하세요.",
            "count": count,
        }
    return None


def check_error_retry(state, tool_input_str):
    """LB-002: 동일 에러 반복 재시도 감지."""
    if not tool_input_str:
        return None

    # 에러 시그니처: 명령어의 앞 200자
    sig = tool_input_str[:200].strip()
    if not sig:
        return None

    count = state["error_retries"].get(sig, 0) + 1
    state["error_retries"][sig] = count

    rule = RULES["LB-002"]

    if count >= rule["max_count"]:
        return {
            "rule": "LB-002",
            "action": rule["action"],
            "message": f"⛔ [{rule['name']}] 동일 명령 {count}회 반복. "
                       f"같은 접근을 반복하지 말고 다른 방법을 시도하세요.",
            "count": count,
        }
    elif count >= rule["warn_at"]:
        return {
            "rule": "LB-002",
            "action": "warn",
            "message": f"⚠️ [{rule['name']}] 동일 명령 {count}/{rule['max_count']}회 반복 감지.",
            "count": count,
        }
    return None


def check_agent_recursion(state, agent_name):
    """LB-004: 에이전트 재귀 감지 (A→B→A 핑퐁 패턴)."""
    if not agent_name:
        return None

    stack = state["agent_stack"]
    stack.append(agent_name)

    # 스택 크기 제한 (최근 50개만)
    if len(stack) > 50:
        state["agent_stack"] = stack[-25:]
        stack = state["agent_stack"]

    # A,B,A,B,A 핑퐁 패턴 감지
    recursion_count = 0
    if len(stack) >= 3:
        for i in range(len(stack) - 1, 1, -1):
            if stack[i] == stack[i - 2] and stack[i] != stack[i - 1]:
                recursion_count += 1
            else:
                break

    rule = RULES["LB-004"]

    if recursion_count >= rule["max_count"]:
        return {
            "rule": "LB-004",
            "action": rule["action"],
            "message": f"⛔ [{rule['name']}] 에이전트 핑퐁 {recursion_count}회. "
                       f"재귀 호출을 중단하고 직접 처리하세요.",
            "count": recursion_count,
        }
    elif recursion_count >= rule["warn_at"]:
        return {
            "rule": "LB-004",
            "action": "warn",
            "message": f"⚠️ [{rule['name']}] 에이전트 핑퐁 {recursion_count}/{rule['max_count']}회 감지.",
            "count": recursion_count,
        }
    return None


def process_hook(hook_input):
    """PreToolUse 훅 메인 로직."""
    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    state = load_state()
    result = None

    # LB-001: Edit/Write 도구 → 파일 편집 추적
    if tool_name in ("Edit", "Write"):
        file_path = tool_input.get("file_path", "")
        result = check_file_edit(state, file_path)

    # LB-002: Bash 도구 → 동일 명령 반복 추적
    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        result = check_error_retry(state, command)

    # LB-004: Agent 도구 → 에이전트 재귀 추적
    elif tool_name == "Agent":
        agent_desc = tool_input.get("description", "")
        result = check_agent_recursion(state, agent_desc)

    save_state(state)

    if result is None:
        return  # 허용 — 아무 출력 없음

    # 경고/차단 기록
    record = {
        "time": time.strftime("%H:%M:%S"),
        "rule": result["rule"],
        "tool": tool_name,
        "count": result["count"],
    }

    if result["action"] in ("pause", "abort"):
        state["blocks_issued"].append(record)
        save_state(state)
        # 차단: decision=block
        output = {
            "decision": "block",
            "reason": result["message"],
        }
        print(json.dumps(output, ensure_ascii=False))
    else:
        # warn: systemMessage로 경고만 전달
        state["warnings_issued"].append(record)
        save_state(state)
        output = {
            "systemMessage": result["message"],
        }
        print(json.dumps(output, ensure_ascii=False))


def reset_state():
    """세션 시작 시 상태 초기화."""
    state = new_state()
    save_state(state)
    return state


# ── CLI 진입점 ──
if __name__ == "__main__":
    # --reset 플래그: 세션 시작 시 초기화용
    if len(sys.argv) > 1 and sys.argv[1] == "--reset":
        reset_state()
        print(json.dumps({"status": "loop_breaker reset"}))
        sys.exit(0)

    # --stats 플래그: 현재 카운터 조회
    if len(sys.argv) > 1 and sys.argv[1] == "--stats":
        state = load_state()
        top_files = sorted(
            state["file_edits"].items(), key=lambda x: x[1], reverse=True
        )[:5]
        stats = {
            "session": state["session_id"],
            "top_edited_files": {os.path.basename(k): v for k, v in top_files},
            "error_retries": len(state["error_retries"]),
            "agent_stack_depth": len(state["agent_stack"]),
            "warnings": len(state["warnings_issued"]),
            "blocks": len(state["blocks_issued"]),
        }
        print(json.dumps(stats, ensure_ascii=False, indent=2))
        sys.exit(0)

    # 기본: stdin에서 PreToolUse JSON 읽기
    try:
        raw = sys.stdin.read()
        if raw.strip():
            hook_input = json.loads(raw)
            process_hook(hook_input)
    except (json.JSONDecodeError, KeyError):
        pass  # 파싱 실패 시 허용 (안전 우선)
