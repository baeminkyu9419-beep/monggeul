"""
MONGGEUL dreamlog 서버 저장 — 로그인 사용자 dreams 테이블 실시간 동기화 검증
================================================================================

배경 (2026-06-16):
  기존 꿈 저장(saveToDreamlog)은 localStorage('mg_logs')만 썼다. 제품은 '영구
  소장'류로 광고하나 서버(dreams 테이블) 저장이 없어 기기 교체/캐시 삭제 시
  유실됐다(= 광고와 실제 기능 괴리 PARTIAL_STUB).

  → dream.js 에 syncDreamToServer() / flushPendingDreamSync() 를 추가:
    - 로그인 사용자(supabase 세션 보유, 로컬 게스트 아님) = dreams 테이블에 insert
    - 게스트/비로그인 = localStorage 만(서버 계정 없음 → no-op, 기존 동작 유지)
    - 실패 = 조용히 삼키지 않고 mg_dreams_pending_sync 큐 + 다음 저장/로그인 시 재시도
      (subscription.js 의 pending_sync 패턴과 일관)
    - dreams 스키마(supabase/schema.sql) 컬럼 정확히 매핑: content/title/badges/
      emotions/keywords/result/radar_data/created_at, 소유권 user_id=auth.uid()

이 테스트가 존재하는 이유:
  다음 세션이 서버 저장을 무심코 제거/약화하거나(localStorage-only 회귀), 게스트
  데이터를 서버로 잘못 쓰거나, 실패를 조용히 삼키는(폴백 큐 제거) 회귀를 코드로
  영구 차단한다.

Node 미설치 시 런타임 부분만 skip(다른 테스트 파일과 동일한 portability 원칙).
"""

import json
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DREAM = ROOT / "src" / "tabs" / "dream.js"
AUTH = ROOT / "src" / "services" / "auth.js"
SCHEMA = ROOT / "supabase" / "schema.sql"


# ─────────────────────────────────────────────────────────────
# Part 1: 소스 파싱 — 서버 저장 계약 (Node 불필요, 항상 실행)
# ─────────────────────────────────────────────────────────────

def test_sync_functions_exist():
    """dream.js 는 서버 저장/큐 재시도 함수를 정의하고 window 에 노출해야 한다."""
    src = DREAM.read_text(encoding="utf-8")
    assert "export async function syncDreamToServer" in src, "syncDreamToServer 미정의(서버 저장 경로 부재)"
    assert "export async function flushPendingDreamSync" in src, "flushPendingDreamSync 미정의(재시도 경로 부재)"
    assert "window.syncDreamToServer" in src and "window.flushPendingDreamSync" in src


def test_save_triggers_server_sync():
    """saveToDreamlog 는 localStorage 저장 후 서버 동기화를 호출해야 한다(localStorage-only 회귀 차단)."""
    src = DREAM.read_text(encoding="utf-8")
    # mg_logs 저장은 유지
    assert "localStorage.setItem('mg_logs'" in src
    # 그리고 서버 저장 트리거가 같은 경로에 배선됨
    assert "syncDreamToServer(newLog)" in src, "저장 시 서버 동기화 미트리거"


def test_guest_not_synced():
    """게스트/비로그인은 서버에 쓰지 않는다 — _canSyncDream 게이트(isLocalGuest 제외)."""
    src = DREAM.read_text(encoding="utf-8")
    assert "function _canSyncDream" in src
    assert "store.supabase" in src and "store.currentUser" in src
    assert "isLocalGuest" in src, "로컬 게스트를 서버 저장 대상에서 제외하는 가드 부재"


def test_failure_not_silently_swallowed():
    """저장 실패는 조용히 삼키지 않고 폴백 큐 + 로그 — pending_sync 패턴."""
    src = DREAM.read_text(encoding="utf-8")
    assert "mg_dreams_pending_sync" in src, "재시도 큐 키 부재"
    assert "_queuePendingDream" in src, "실패 적재 함수 부재"
    assert "console.error" in src, "실패 무음 삼킴(로그 부재)"


def test_dream_row_maps_schema_columns():
    """_dreamRow 매핑이 dreams 테이블 스키마 컬럼과 일치해야 한다(소유권 user_id 포함)."""
    src = DREAM.read_text(encoding="utf-8")
    # schema.sql dreams 컬럼
    schema = SCHEMA.read_text(encoding="utf-8")
    assert "create table if not exists dreams" in schema
    for col in ("content", "title", "badges", "emotions", "keywords", "result", "radar_data", "created_at"):
        assert col in schema, f"스키마에 {col} 컬럼 없음(테스트 전제 깨짐)"
    # 매핑이 핵심 컬럼을 채움 + 소유권
    assert "user_id: userId" in src, "소유권(user_id=현재 사용자) 미설정 — RLS auth.uid()=user_id 위반"
    assert "content: log.text" in src
    assert "radar_data: log.stats" in src
    assert "from('dreams').insert" in src, "dreams 테이블 insert 경로 부재"


def test_login_flushes_pending():
    """auth.js onLoginSuccess 는 세션 확립 후 큐 재시도(flush)를 호출해야 한다."""
    src = AUTH.read_text(encoding="utf-8")
    assert "flushPendingDreamSync" in src, "로그인 후 미동기화 꿈 재시도 미배선"


# ─────────────────────────────────────────────────────────────
# Part 2: 런타임 — fake supabase 로 실제 동작 검증 (Node 필요)
# ─────────────────────────────────────────────────────────────

# 브라우저 전역 shim + fake supabase 로 dream.js 의 실제 sync 함수를 실행한다.
# (dream.js 는 localStorage/document/window 를 모듈 로드 시 참조 → 최소 shim 주입)
_RUNTIME_SCRIPT = r"""
const _ls = new Map();
globalThis.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k,v) => _ls.set(k, String(v)),
  removeItem: k => _ls.delete(k),
};
const elStub = () => ({ style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}}, setAttribute(){}, getAttribute(){return null}, addEventListener(){}, appendChild(){}, prepend(){}, insertBefore(){}, querySelector(){return null}, querySelectorAll(){return []}, scrollIntoView(){}, focus(){}, blur(){}, remove(){}, innerHTML:'' });
globalThis.document = { getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:elStub, addEventListener:()=>{}, body:elStub(), activeElement:null };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => {};

const dream = await import(DREAM_URI);
const { store } = await import(STORE_URI);

function makeSupabase(failMode){
  const calls = [];
  return { _calls: calls, from(table){ return { insert: async (row) => { calls.push({table,row}); return failMode ? {error:{message:'boom'}} : {error:null}; } }; } };
}

const sampleLog = {id:1718000000000, text:'뱀이 나오는 꿈', title:'변화의 신호', badges:['길몽'], emotions:['놀람'], stats:{길흉:70}, result:{title:'변화의 신호'}};
const out = {};

// 1) 로그인 사용자 → insert 호출 + 컬럼/소유권 정확
{ _ls.clear(); store.supabase = makeSupabase(false); store.currentUser = { id:'user-uuid-123' };
  out.loggedin_ok = await dream.syncDreamToServer(sampleLog);
  out.loggedin_calls = store.supabase._calls.length;
  out.loggedin_table = store.supabase._calls[0] && store.supabase._calls[0].table;
  out.loggedin_user_id = store.supabase._calls[0] && store.supabase._calls[0].row.user_id;
  out.loggedin_content = store.supabase._calls[0] && store.supabase._calls[0].row.content;
  out.loggedin_keys = store.supabase._calls[0] ? Object.keys(store.supabase._calls[0].row).sort() : [];
}
// 2) 로컬 게스트 → 미호출
{ _ls.clear(); store.supabase = makeSupabase(false); store.currentUser = { id:'guest_x', isLocalGuest:true };
  out.guest_ok = await dream.syncDreamToServer(sampleLog);
  out.guest_calls = store.supabase._calls.length;
}
// 2b) supabase/user 없음 → 미호출
{ _ls.clear(); store.supabase = null; store.currentUser = null;
  out.nouser_ok = await dream.syncDreamToServer(sampleLog);
}
// 3) 실패 → 폴백 큐 적재(무음 삼킴 X)
{ _ls.clear(); store.supabase = makeSupabase(true); store.currentUser = { id:'user-uuid-123' };
  out.fail_ok = await dream.syncDreamToServer(sampleLog);
  out.fail_queued = JSON.parse(localStorage.getItem('mg_dreams_pending_sync')||'[]').length;
}
// 4) flush → 큐 재시도 성공 시 큐 비움
{ _ls.clear(); localStorage.setItem('mg_dreams_pending_sync', JSON.stringify([sampleLog]));
  store.supabase = makeSupabase(false); store.currentUser = { id:'user-uuid-123' };
  await dream.flushPendingDreamSync();
  out.flush_calls = store.supabase._calls.length;
  out.flush_cleared = localStorage.getItem('mg_dreams_pending_sync') === null;
}

console.log(JSON.stringify(out));
"""


def _run_runtime():
    node = shutil.which("node")
    if not node:
        pytest.skip("node 미설치 — 서버 저장 런타임 검증 skip")
    script = (
        _RUNTIME_SCRIPT
        .replace("DREAM_URI", json.dumps(DREAM.resolve().as_uri()))
        .replace("STORE_URI", json.dumps((ROOT / "src" / "store.js").resolve().as_uri()))
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=60,
    )
    assert proc.returncode == 0, f"node 실행 실패:\nSTDOUT={proc.stdout}\nSTDERR={proc.stderr}"
    # console.error 가 섞일 수 있으므로 마지막 JSON 라인만 파싱
    line = [l for l in proc.stdout.strip().splitlines() if l.strip().startswith("{")][-1]
    return json.loads(line)


def test_runtime_loggedin_inserts_dream():
    """로그인 사용자 저장 시 dreams 테이블에 insert 되고 소유권/컬럼이 정확해야 한다."""
    out = _run_runtime()
    assert out["loggedin_ok"] is True
    assert out["loggedin_calls"] == 1, "로그인인데 insert 미호출(서버 저장 안 됨)"
    assert out["loggedin_table"] == "dreams"
    assert out["loggedin_user_id"] == "user-uuid-123", "소유권 user_id 불일치(RLS 위반 위험)"
    assert out["loggedin_content"] == "뱀이 나오는 꿈"
    # 스키마 핵심 컬럼이 행에 존재
    for col in ("user_id", "content", "title", "badges", "emotions", "keywords", "result", "radar_data", "created_at"):
        assert col in out["loggedin_keys"], f"insert 행에 {col} 컬럼 누락"


def test_runtime_guest_not_synced():
    """로컬 게스트 / 비로그인은 서버에 쓰지 않는다(localStorage 만)."""
    out = _run_runtime()
    assert out["guest_ok"] is False
    assert out["guest_calls"] == 0, "게스트인데 서버 insert 호출됨(잘못된 서버 쓰기)"
    assert out["nouser_ok"] is False, "supabase/user 없는데 저장 시도됨"


def test_runtime_failure_falls_back_to_queue():
    """서버 저장 실패 시 조용히 삼키지 않고 폴백 큐에 적재돼야 한다."""
    out = _run_runtime()
    assert out["fail_ok"] is False
    assert out["fail_queued"] == 1, "실패가 무음 삼킴됨(재시도 큐 미적재)"


def test_runtime_flush_retries_and_clears():
    """flushPendingDreamSync 는 큐를 재시도하고 성공분을 큐에서 제거해야 한다."""
    out = _run_runtime()
    assert out["flush_calls"] == 1, "큐 재시도 미실행"
    assert out["flush_cleared"] is True, "재시도 성공인데 큐가 비워지지 않음"
