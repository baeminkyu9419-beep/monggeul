"""
MONGGEUL — CONVERSION-3: UX 마찰 완화 회귀 테스트

(1) 온보딩(환영 선물) 모달을 앱 진입 즉시 → 첫 꿈 결과 직후로 이동(가치 우선).
    - app.js 가 더 이상 진입 시 무조건 showOnboarding() 하지 않는다(첫 꿈 기록 전 신규 유저).
    - dream.js showResult 가 첫 해몽(dreamCount===0) 후 showOnboarding 을 트리거한다.
(2) 백엔드 다운(데모 모드 = supabase 미연결) 구간 게스트 무료 1 → 3회 완화(로컬).
    - 백엔드 정상 구간은 기존 1회 유지(로그인 유도).

뮤테이션 정신:
  - (2)는 Node 런타임으로 실제 게이트(canUseDream/incDreamCount) 를 fake store 로 구동해
    백엔드 down=3 / up=1 을 검증. 완화 분기를 제거하면 FAIL.
"""

import json
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "src" / "app.js"
DREAM = ROOT / "src" / "tabs" / "dream.js"
SUB = ROOT / "src" / "services" / "subscription.js"
STORE = ROOT / "src" / "store.js"


# ─────────────────────────────────────────────────────────────
# (1) 온보딩 이동 — 가치 우선
# ─────────────────────────────────────────────────────────────

def test_app_open_no_unconditional_onboarding():
    """app.js 진입부가 무조건 showOnboarding() 을 호출하면 안 된다(신규 유저=결과 먼저)."""
    src = APP.read_text(encoding="utf-8")
    # 진입부의 '무조건 호출' 패턴(try{ window.showOnboarding?.(); }catch) 이 제거되어야 함.
    # 재방문자 보정 호출은 mg_logs.length>0 가드 안에 있어야 한다.
    unconditional = re.search(r"try\s*\{\s*window\.showOnboarding\?\.\(\);\s*\}catch", src)
    assert unconditional is None, (
        "app.js 가 여전히 진입 즉시 무조건 showOnboarding() 호출 — 첫인상 마찰 미해소"
    )


def test_app_open_onboarding_guarded_by_logs():
    """재방문자(이미 꿈 기록) 보정 노출만 남아야 한다 — mg_logs.length>0 가드 존재."""
    src = APP.read_text(encoding="utf-8")
    assert "_logs.length>0" in src and "window.showOnboarding?.()" in src, (
        "재방문자 온보딩 보정(선물 누락 방지) 가드가 없음"
    )


def test_showResult_triggers_onboarding_after_first_dream():
    """dream.js showResult 가 첫 해몽(dreamCount===0 & 미온보딩) 후 showOnboarding 을 트리거."""
    src = DREAM.read_text(encoding="utf-8")
    m = re.search(r"export function showResult\([^)]*\)\s*\{([\s\S]*?)\n\}\n", src)
    assert m, "showResult 함수를 찾을 수 없습니다"
    body = m.group(1)
    assert "mg_onboarded" in body, "showResult 가 온보딩 여부를 확인하지 않음"
    assert "dreamCount===0" in body or "dreamCount === 0" in body, (
        "첫 해몽 조건(dreamCount===0)으로 게이팅하지 않음 — 매 해몽마다 모달 노출 위험"
    )
    assert "showOnboarding" in body, "첫 해몽 후 showOnboarding 트리거 누락"


# ─────────────────────────────────────────────────────────────
# (2) 백엔드 다운 게스트 1→3 — 소스 + 런타임
# ─────────────────────────────────────────────────────────────

def test_guest_demo_limit_constant():
    """GUEST_DEMO_LIMIT 상수가 3 으로 정의되어야 한다."""
    src = SUB.read_text(encoding="utf-8")
    assert re.search(r"GUEST_DEMO_LIMIT\s*=\s*3", src), "GUEST_DEMO_LIMIT=3 상수 누락"


def test_guest_path_branches_on_backend_state():
    """canUseDream 게스트 경로가 backend down(supabase 없음) 여부로 분기해야 한다."""
    src = SUB.read_text(encoding="utf-8")
    m = re.search(r"export async function canUseDream\(\)\s*\{([\s\S]*?)\n\}", src)
    assert m, "canUseDream 을 찾을 수 없습니다"
    body = m.group(1)
    assert "!store.supabase" in body, "백엔드 다운 감지(!store.supabase) 분기 없음"
    assert "GUEST_DEMO_LIMIT" in body, "백엔드 다운 시 GUEST_DEMO_LIMIT 적용 안 함"
    assert "mg_guest_dream_count" in body, "데모 게스트 카운터 키 없음"


_RUNTIME = r"""
const _ls = new Map();
globalThis.localStorage = { getItem: k => (_ls.has(k)?_ls.get(k):null), setItem:(k,v)=>_ls.set(k,String(v)), removeItem:k=>_ls.delete(k), clear:()=>_ls.clear() };
globalThis.window = globalThis;
const sub = await import(SUB_URI);
const { store } = await import(STORE_URI);
const out = {};

// 백엔드 DOWN(데모): 게스트 3회
_ls.clear(); store.supabase=null; store.currentUser=null;
let demo=0;
for(let i=0;i<6;i++){ const g=await sub.canUseDream(); if(g.allowed){ demo++; await sub.incDreamCount(); } }
out.demo_allowed = demo;
out.demo_after_reason = (await sub.canUseDream()).reason;
out.demo_first_remaining = (()=>{ _ls.clear(); store.supabase=null; store.currentUser=null; return null; })();
_ls.clear(); store.supabase=null; store.currentUser=null;
out.demo_first = await sub.canUseDream();

// 백엔드 UP(supabase 존재): 게스트 1회 (기존 유지)
_ls.clear(); store.supabase={ from(){return{}}, rpc(){return Promise.resolve({})} }; store.currentUser=null;
let up=0;
for(let i=0;i<6;i++){ const g=await sub.canUseDream(); if(g.allowed){ up++; await sub.incDreamCount(); } }
out.up_allowed = up;
out.up_after_reason = (await sub.canUseDream()).reason;

console.log(JSON.stringify(out));
"""


def _run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 게스트 한도 런타임 검증 skip")
    script = (
        _RUNTIME
        .replace("SUB_URI", json.dumps(SUB.resolve().as_uri()))
        .replace("STORE_URI", json.dumps(STORE.resolve().as_uri()))
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


def test_runtime_guest_3_when_backend_down():
    """백엔드 다운(데모) 구간 게스트는 정확히 3회 무료 + 4회차부터 guest_limit."""
    out = _run()
    assert out["demo_allowed"] == 3, f"데모 게스트 무료 횟수 {out['demo_allowed']} (기대 3)"
    assert out["demo_after_reason"] == "guest_limit", "데모 게스트 소진 후 guest_limit 아님"
    assert out["demo_first"]["remaining"] == 3, "데모 게스트 첫 remaining 이 3 아님"


def test_runtime_guest_1_when_backend_up():
    """백엔드 정상 구간 게스트는 기존대로 1회(로그인 유도) — 무차별 완화 방지(회귀 가드)."""
    out = _run()
    assert out["up_allowed"] == 1, f"백엔드 정상인데 게스트 무료 {out['up_allowed']}회 (기대 1)"
    assert out["up_after_reason"] == "guest_limit", "정상 구간 게스트 소진 후 guest_limit 아님"
