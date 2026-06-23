"""프론트↔엣지함수 요청 계약 테스트 (2026-06-23).

배경: 2026-06-23 라이브 monggeul 꿈해석이 HTTP 500 으로 깨져 있었다. 근본은 배포
드리프트(엣지함수가 옛 `payload.messages` 형식 기대, 프론트는 새 `task/params` 전송).
이 테스트는 그 '형식 불일치' 클래스를 repo 안에서 미리 잡는다(데모/단위 아닌 계약).

검증:
  1. 프론트 callChat('task',...) 의 모든 task 가 엣지 buildChatPayload 에 존재(없으면
     런타임 'Invalid task'/500 → 드리프트).
  2. 엣지 ALLOWED_ENDPOINTS 에 'chat' 존재.
  3. callOpenAI 가 endpoint==='chat' 을 throw 로 차단(구형 payload.messages chat 금지).
  4. 엣지 chat 경로가 buildChatPayload(task, params) 사용(클라 messages 직접 사용 금지=계약+보안).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase" / "functions" / "openai-proxy" / "index.ts"
PROMPTS = ROOT / "supabase" / "functions" / "openai-proxy" / "prompts.ts"
API = ROOT / "src" / "services" / "api.js"
SRC = ROOT / "src"


def _edge_allowed_endpoints() -> set[str]:
    t = EDGE.read_text(encoding="utf-8")
    m = re.search(r"ALLOWED_ENDPOINTS\s*=\s*new Set<string>\(\[([^\]]*)\]", t)
    assert m, "ALLOWED_ENDPOINTS 정의를 찾지 못함(파서/구조 변경)"
    return set(re.findall(r"'([a-z_]+)'", m.group(1)))


def _edge_chat_tasks() -> set[str]:
    t = PROMPTS.read_text(encoding="utf-8")
    return set(re.findall(r"case\s+'([a-z_]+)'\s*:", t))


def _frontend_callchat_tasks() -> set[str]:
    tasks = set()
    for f in SRC.rglob("*.js"):
        for m in re.finditer(r"callChat\(\s*['\"]([a-z_]+)['\"]", f.read_text(encoding="utf-8")):
            tasks.add(m.group(1))
    return tasks


def test_all_frontend_tasks_known_by_edge():
    fe = _frontend_callchat_tasks()
    edge = _edge_chat_tasks()
    assert fe, "callChat 호출처 0건 — 파서 깨짐 의심"
    assert edge, "엣지 buildChatPayload task 0건 — 파서 깨짐 의심"
    unknown = fe - edge
    assert not unknown, (
        f"프론트가 보내는 task가 엣지에 없음(배포 시 런타임 'Invalid task'/500 드리프트): "
        f"{unknown}. 엣지 task={edge}. 프론트 task 추가 시 prompts.ts 의 buildChatPayload "
        f"case 도 같이 추가해야 한다.")


def test_chat_endpoint_is_allowed():
    assert "chat" in _edge_allowed_endpoints()


def test_callopenai_blocks_old_chat_format():
    t = API.read_text(encoding="utf-8")
    # callOpenAI 가 chat 을 throw 로 막아 구형 payload.messages chat 경로를 차단.
    assert re.search(r"endpoint\s*===\s*'chat'", t), "callOpenAI 의 chat 가드가 사라짐"
    assert "throw" in t, "chat 구형 형식 차단 throw 가 사라짐"


def test_edge_chat_uses_task_params_contract():
    t = EDGE.read_text(encoding="utf-8")
    # chat 경로가 buildChatPayload(task, params) 로 서버조립(클라 messages 직접 사용 금지).
    assert "buildChatPayload(task, params)" in t, (
        "엣지 chat 이 buildChatPayload(task, params) 계약을 안 씀 — 클라 형식과 드리프트 위험")
