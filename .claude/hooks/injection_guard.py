#!/usr/bin/env python3
"""
Hook: injection_guard (pre_tool_use)
ARKIS — 외부 API 응답·파일·웹 데이터에서 프롬프트 인젝션 패턴 감지 및 차단.
exit 0: 통과 / exit 1 + stderr: 차단
"""
import json, sys, re
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LOG_DIR   = REPO_ROOT / ".claude" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

PATTERNS = [
    r"(?i)(ignore\s+previous\s+instructions?)",
    r"(?i)(forget\s+everything|disregard\s+all)",
    r"(?i)(you\s+are\s+now\s+(?:a\s+)?(?:different|new|another)\s+(?:ai|assistant|model))",
    r"(?i)(new\s+system\s+prompt|override\s+system)",
    r"(?i)(act\s+as\s+(?:an?\s+)?(?:evil|unrestricted|jailbroken))",
    r"(?i)(reveal\s+your\s+(?:system\s+)?prompt|show\s+me\s+your\s+instructions?)",
    r"(?i)(print\s+your\s+(system\s+)?prompt)",
    r"(?i)(sudo|root\s+access|admin\s+mode|developer\s+mode)",
    r"(?i)(bypass\s+(?:all\s+)?(?:safety|security|restrictions?))",
    r"(?i)(DAN\s+mode|jailbreak)",
    r"(?i)(\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>)",
    r"(?i)(###\s*system|###\s*human|###\s*assistant)",
    r"이전\s*지시사항을\s*무시",
    r"시스템\s*프롬프트를?\s*(?:출력|공개|보여)",
    r"제한\s*없이\s*(?:답변|응답)",
]
COMPILED = [re.compile(p) for p in PATTERNS]

def check(text: str) -> list:
    return [PATTERNS[i] for i, p in enumerate(COMPILED) if p.search(text)]

def extract(data: dict) -> str:
    parts = []
    ti = data.get("tool_input", {})
    if isinstance(ti, dict):
        parts += [v for v in ti.values() if isinstance(v, str)]
    for key in ("result", "content"):
        val = data.get(key, "")
        if isinstance(val, str): parts.append(val)
    return " ".join(parts)

def main():
    try:
        raw  = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    text  = extract(data)
    found = check(text) if text else []

    if found:
        log = {"event": "injection_blocked", "timestamp": datetime.now().isoformat(),
               "count": len(found), "tool": data.get("tool_name", "unknown"), "snippet": text[:200]}
        with open(LOG_DIR / "security_log.jsonl", "a") as f:
            f.write(json.dumps(log, ensure_ascii=False) + "\n")
        print(f"[ARKIS 보안] 인젝션 패턴 {len(found)}개 감지. 해당 데이터를 신뢰하지 마십시오.", file=sys.stderr)
        sys.exit(1)

    sys.exit(0)

if __name__ == "__main__":
    main()
