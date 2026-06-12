"""
MONGGEUL 운영 관측성 (P0-1 notifyOps · P1-2 catch 로깅 · P1-3 익명 에러 적재)
================================================================================

배경 (2026-06-13 감사 적중 운영 갭 3건):
  P0-1: 결제 실패·취소/환불·웹훅 서명 거부·처리 예외를 운영자가 알 채널이 코드에 전무.
        → supabase/functions/_shared/notify-ops.ts 신설(Discord webhook, env 부재 시
          silent skip). toss-confirm/toss-webhook/stripe-webhook 실패 경로에 배선.
  P1-2: 결제 edge function 3개 catch 블록이 전부 0줄 — Supabase function logs 에서
        장애 추적 불가. → console.error(상관관계 id, 메시지) 의무화.
  P1-3: src/services/analytics.js logEvent 가 store.currentUser 없으면 전량 드랍 —
        부팅 직후(익명 세션 확립 전) js_error·정식 오픈 후 비로그인·로컬 게스트
        ('guest_...' 는 uuid 가 아니라 insert 자체가 무음 실패)가 모두 유실.
        → 익명 user_id null + properties.anon_id(mg_ab_anon_id 규약 재사용),
          RLS 최소 개방 마이그레이션(js_error/js_rejection 한정).

  수술 불변식 (이 테스트가 고정):
    1) notifyOps 는 절대 throw 하지 않는다 — 알림 실패가 결제 흐름을 못 죽인다.
    2) env 부재 = silent skip (콘솔 1줄) — 함수 동작 자체는 무변.
    3) 알림/로그에 시크릿·카드정보 없음 — orderId/event.id·코드·메시지만.
    4) 기존 응답 의미 보존 — 서명 거부 4xx, 처리 예외 500 불변.
    5) 익명 RLS 개방은 insert + user_id null + 에러 이벤트 2종으로 한정.

Deno 미설치 → .ts/.js 를 실행하지 않고 소스 텍스트에서 계약을 파싱한다
(test_webhook_dedup.py · test_toss_routing.py 와 동일 규약).
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FUNCS = ROOT / "supabase" / "functions"
MIGRATIONS = ROOT / "supabase" / "migrations"

NOTIFY_TS = FUNCS / "_shared" / "notify-ops.ts"
CONFIRM_TS = FUNCS / "toss-confirm" / "index.ts"
TOSS_TS = FUNCS / "toss-webhook" / "index.ts"
STRIPE_TS = FUNCS / "stripe-webhook" / "index.ts"
ANALYTICS_JS = ROOT / "src" / "services" / "analytics.js"
ANON_POLICY_SQL = MIGRATIONS / "20260613_anon_error_events.sql"

PAYMENT_FUNCS = (CONFIRM_TS, TOSS_TS, STRIPE_TS)


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _catch_block(src: str) -> str:
    """serve() 최외곽 catch (error) 블록 본문 (마지막 catch = 핸들러 전체 캐치)."""
    matches = list(re.finditer(r"\} catch \(error\) \{(.*?)\n\s*\}\n\}\)", src, re.DOTALL))
    assert matches, "outer catch (error) block not found"
    return matches[-1].group(1)


# ═══════════════════════════════════════════════════════════════
# §1 P0-1 — notifyOps 공용 모듈 계약
# ═══════════════════════════════════════════════════════════════

class TestNotifyOpsModule:
    @pytest.fixture(autouse=True)
    def _src(self):
        assert NOTIFY_TS.exists(), "_shared/notify-ops.ts 부재 — 운영자 알림 채널 소실"
        self.src = _read(NOTIFY_TS)

    def test_exports_notify_ops(self):
        assert "export async function notifyOps" in self.src

    def test_env_gate_with_silent_skip(self):
        """DISCORD_OPS_WEBHOOK 부재 시 silent skip(콘솔 1줄 + return) — 함수 동작 무변."""
        assert "Deno.env.get('DISCORD_OPS_WEBHOOK')" in self.src
        m = re.search(r"if \(!url\) \{\s*console\.log\(.*?\)\s*return\s*\}", self.src, re.DOTALL)
        assert m, "env 부재 시 console.log 1줄 + return (silent skip) 이어야 한다"

    def test_never_throws(self):
        """불변식 1: 본문 전체 try/catch + catch 에서 rethrow 없음 — 결제 흐름 보호."""
        m = re.search(r"export async function notifyOps[^{]*\{\s*try \{", self.src)
        assert m, "notifyOps 본문 첫 문장이 try 여야 한다 (전체 감싸기)"
        catch = re.search(r"\} catch \(e\) \{(.*?)\}", self.src, re.DOTALL)
        assert catch, "notifyOps 에 catch 부재"
        assert "throw" not in catch.group(1), "notifyOps catch 가 rethrow — 결제 흐름 사망 경로"

    def test_discord_content_length_capped(self):
        """Discord content 한도 2000자 — 절단 가드."""
        assert ".slice(0, 1900)" in self.src

    def test_posts_to_discord_webhook(self):
        assert "method: 'POST'" in self.src
        assert "JSON.stringify({ content:" in self.src


# ═══════════════════════════════════════════════════════════════
# §2 P0-1 — 배선: 결제 3 함수의 실패 경로에 notifyOps
# ═══════════════════════════════════════════════════════════════

class TestNotifyOpsWiring:
    def test_all_payment_funcs_import_shared_module(self):
        for ts in PAYMENT_FUNCS:
            src = _read(ts)
            assert 'import { notifyOps } from "../_shared/notify-ops.ts"' in src, (
                f"{ts.parent.name}: _shared 공용 모듈 import 누락 (복붙 사본 금지)"
            )

    def test_toss_confirm_approve_failure_notifies(self):
        """승인 실패(status!=='DONE') 경로: failed 마킹 후·400 반환 전 알림."""
        src = _read(CONFIRM_TS)
        idx_failed = src.index("status: 'failed'")
        idx_notify = src.index("토스 결제 승인 실패")
        idx_return = src.index("success: false")
        assert idx_failed < idx_notify < idx_return, (
            "승인 실패 알림은 failed 마킹 후·400 응답 전이어야 한다"
        )

    def test_toss_confirm_catch_notifies(self):
        assert "notifyOps(`🔥 toss-confirm 처리 예외" in _catch_block(_read(CONFIRM_TS))

    def test_toss_webhook_signature_rejection_notifies(self):
        """서명 거부 → 알림 후 401 (응답 의미 보존)."""
        src = _read(TOSS_TS)
        m = re.search(r"if \(!isValid\) \{(.*?)\n    \}", src, re.DOTALL)
        assert m, "toss-webhook 서명 거부 분기 부재"
        block = m.group(1)
        assert "notifyOps" in block and "서명 거부" in block
        assert "status: 401" in block, "서명 거부 = 401 의미 보존"

    def test_toss_webhook_cancel_refund_notifies(self):
        """취소/환불(CANCELED/PARTIAL_CANCELED) 처리 분기에 알림."""
        src = _read(TOSS_TS)
        m = re.search(r"case 'PAYMENT_STATUS_CHANGED':\s*\{(.*?)\n\s*case ", src, re.DOTALL)
        assert m, "PAYMENT_STATUS_CHANGED case not found"
        block = m.group(1)
        assert "notifyOps" in block and "취소" in block
        assert "data.orderId" in block

    def test_toss_webhook_catch_notifies(self):
        assert "notifyOps(`🔥 toss-webhook 처리 예외" in _catch_block(_read(TOSS_TS))

    def test_stripe_webhook_signature_rejection_notifies(self):
        src = _read(STRIPE_TS)
        idx_notify = src.index("stripe-webhook 서명 거부")
        idx_return = src.index("return new Response('Invalid signature', { status: 400 })")
        assert idx_notify < idx_return, "서명 거부 알림은 400 반환 전이어야 한다"

    def test_stripe_webhook_catch_notifies(self):
        assert "notifyOps(`🔥 stripe-webhook 처리 예외" in _catch_block(_read(STRIPE_TS))

    def test_no_secrets_in_notify_payloads(self):
        """불변식 3: 알림 본문 템플릿에 시크릿·카드정보·전체 페이로드 금지."""
        forbidden = ("SECRET_KEY", "paymentKey=", "cardNumber", "raw_response", "JSON.stringify(body")
        for ts in PAYMENT_FUNCS:
            for call in re.findall(r"notifyOps\(`(.*?)`\)", _read(ts), re.DOTALL):
                for bad in forbidden:
                    assert bad not in call, f"{ts.parent.name}: 알림 본문에 {bad} — 시크릿/원문 금지"


# ═══════════════════════════════════════════════════════════════
# §3 P1-2 — 결제 3 함수 catch 에 console.error (function logs 추적)
# ═══════════════════════════════════════════════════════════════

class TestCatchLogging:
    @pytest.mark.parametrize("ts,tag,corr", [
        (CONFIRM_TS, "[toss-confirm]", "opsOrderId"),
        (TOSS_TS, "[toss-webhook]", "opsOrderId"),
        (STRIPE_TS, "[stripe-webhook]", "opsEventId"),
    ])
    def test_catch_has_console_error_with_correlation_id(self, ts, tag, corr):
        """catch 0줄 금지: console.error(태그, 상관관계 id, 메시지)."""
        block = _catch_block(_read(ts))
        m = re.search(r"console\.error\('(\[[\w-]+\]) error', (\w+)", block)
        assert m, f"{ts.parent.name}: catch 에 console.error 부재 (P1-2 되돌림)"
        assert m.group(1) == tag and m.group(2) == corr

    @pytest.mark.parametrize("ts", PAYMENT_FUNCS)
    def test_catch_logs_message_not_raw_object_dump(self, ts):
        """error?.message 우선 — 응답/페이로드 통짜 덤프 금지 (카드정보 유입 차단)."""
        block = _catch_block(_read(ts))
        assert "error?.message ?? error" in block
        assert "raw_response" not in block and "tossData" not in block

    def test_correlation_id_hoisted_outside_try(self):
        """상관관계 id 가 serve 핸들러의 try 밖(앞) 선언 — catch 시점에도 참조 가능해야 한다.
        주의: 파일 첫 try 는 헬퍼(fetchTossWithRetry 등)일 수 있어 serve 앵커 뒤 첫 try 로 판정."""
        for ts, decl in ((CONFIRM_TS, "let opsOrderId = ''"),
                         (TOSS_TS, "let opsOrderId = ''"),
                         (STRIPE_TS, "let opsEventId = ''")):
            src = _read(ts)
            assert decl in src, f"{ts.parent.name}: {decl} 부재"
            idx_serve = src.index("serve(async (req)")
            idx_handler_try = src.index("try {", idx_serve)
            assert idx_serve < src.index(decl) < idx_handler_try, (
                f"{ts.parent.name}: 상관관계 id 선언이 serve 핸들러 try 앞이 아님 — catch 에서 미정의"
            )


# ═══════════════════════════════════════════════════════════════
# §4 P1-3 — 비로그인 FE 에러 적재 (analytics.js + RLS 최소 개방)
# ═══════════════════════════════════════════════════════════════

class TestAnonErrorLogging:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(ANALYTICS_JS)

    def test_currentuser_hard_gate_removed(self):
        """기존 유실 게이트(store.supabase && store.currentUser) 제거 — 적재는 supabase 만 조건."""
        assert "store.supabase && store.currentUser" not in self.src
        assert "if (store.supabase)" in self.src

    def test_anonymous_insert_uses_null_user_and_anon_id(self):
        """익명 = user_id null(FK 위반 불가) + properties.anon_id."""
        assert "user_id: isAuthUuid ? uid : null" in self.src
        assert "anon_id: getAnonId()" in self.src

    def test_reuses_existing_localstorage_convention(self):
        """ab-test.js 의 mg_ab_anon_id 규약 재사용 — 새 키 발명 금지."""
        assert "mg_ab_anon_id" in self.src
        ab = _read(ROOT / "src" / "services" / "ab-test.js")
        assert "mg_ab_anon_id" in ab, "원 규약(ab-test.js) 소실 — 키 이름 동기 확인"

    def test_uuid_validation_blocks_local_guest_id(self):
        """'guest_...' 같은 비 uuid 를 user_id 로 보내던 무음 실패 경로 차단."""
        assert "UUID_RE" in self.src
        assert re.search(r"UUID_RE\s*=\s*/\^", self.src), "uuid 정규식 부재"
        # 정규식이 실제 guest id 를 거르는지 파이썬으로 등가 검증
        uuid_re = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
        assert not uuid_re.match("guest_1749700000000")
        assert uuid_re.match("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

    def test_console_fallback_when_supabase_unset(self):
        """Supabase 미설정(데모) — 에러 이벤트는 콘솔 폴백 (무음 전량 유실 금지)."""
        m = re.search(
            r"else if \(event === 'js_error' \|\| event === 'js_rejection'\) \{\s*"
            r".*?console\.warn\('\[logEvent fallback\]'",
            self.src, re.DOTALL)
        assert m, "데모 모드 콘솔 폴백 부재"

    def test_error_handlers_still_route_through_logevent(self):
        """app.js:73-79 전역 핸들러가 logEvent 를 호출 (배선 불변) — 게이트는 logEvent 내부였다."""
        app = _read(ROOT / "src" / "app.js")
        assert "logEvent('js_error'" in app
        assert "logEvent('js_rejection'" in app

    def test_rls_migration_minimal_scope(self):
        """RLS 개방은 insert + user_id null + 에러 이벤트 2종 한정 (과개방 금지)."""
        assert ANON_POLICY_SQL.exists(), "익명 에러 적재 RLS 마이그레이션 부재 — DB 가 FE 적재를 거부"
        sql = _read(ANON_POLICY_SQL).lower()
        assert "for insert to anon, authenticated" in sql
        assert "user_id is null" in sql
        assert "event in ('js_error', 'js_rejection')" in sql
        assert "for select" not in sql, "익명 select 개방 금지"
        assert "for all" not in sql, "insert 외 동사 개방 금지"


# ═══════════════════════════════════════════════════════════════
# §5 뮤테이션 입증 — 되돌림 시 단언이 깨진다 (변경 민감성)
# ═══════════════════════════════════════════════════════════════

class TestMutationProof:
    def test_notify_wiring_removal_is_caught(self):
        """notifyOps 호출 전부 제거(P0-1 되돌림) → §2 단언 FAIL."""
        src = _read(STRIPE_TS)
        mutated = re.sub(r"await notifyOps\(`.*?`\)\n", "", src, flags=re.DOTALL)
        assert mutated != src
        with pytest.raises(ValueError):
            mutated.index("stripe-webhook 서명 거부")

    def test_catch_logging_removal_is_caught(self):
        """catch console.error 제거(P1-2 되돌림) → §3 단언 FAIL."""
        src = _read(CONFIRM_TS)
        mutated = src.replace("console.error('[toss-confirm] error', opsOrderId", "void(opsOrderId", 1)
        assert mutated != src
        block = re.findall(r"\} catch \(error\) \{(.*?)\n\s*\}\n\}\)", mutated, re.DOTALL)[-1]
        assert not re.search(r"console\.error\('\[toss-confirm\] error'", block)

    def test_anon_gate_regression_is_caught(self):
        """analytics.js 에 옛 게이트 복원(P1-3 되돌림) → §4 단언 FAIL."""
        src = _read(ANALYTICS_JS)
        mutated = src.replace("if (store.supabase)", "if (store.supabase && store.currentUser)", 1)
        assert mutated != src
        assert "store.supabase && store.currentUser" in mutated  # §4 게이트 단언이 잡는 형태
