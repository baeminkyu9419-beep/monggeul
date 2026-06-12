"""
MONGGEUL 결제 웹훅 멱등성(dedup) — 회귀 단위 테스트
================================================================================

배경 (왜 이 파일이 존재하나):
  2026-06-13 감사 GAP-1[HIGH]/GAP-4[LOW] 수술:
  - GAP-1: stripe-webhook 의 checkout.session.completed 가 event.id dedup 전무.
    premium_credits 가산형 upsert · entitlements.insert 무가드 → Stripe 정규
    재전송(at-least-once) 1회면 크레딧 이중 적립. 서명·5분 tolerance 는 위조만 막음.
  - GAP-4: toss-webhook BILLING_PAYMENT_DONE 재전송 시 events 중복 row +
    구독 만료일 재연장(expiresAt 매 처리마다 now+duration 재계산) 드리프트.

  수술 설계 (이 테스트가 고정하는 불변식):
    1) 원장 재사용: 신규 webhook_events 테이블을 만들지 않고, 기존
       billing_events(20260321_billing_schema.sql, apple/google 웹훅이 이미 사용)
       를 stripe/toss 도 공용한다 — 같은 목적 테이블 2개 = 재발명 금지.
    2) 원자 claim: select-후-insert(TOCTOU 레이스)가 아니라 insert 선행 —
       PK(event_id) 충돌 23505 → 200 + duplicate:true 즉시 반환
       (2xx = Stripe/토스 재전송 중단 조건).
    3) 위치 불변식: claim 은 서명 검증 이후 · 첫 변이(write) 이전.
    4) 응답 코드 의미 보존: 서명 실패 = 4xx 불변.
    5) 뮤테이션 민감도: dedup 블록을 제거하면 단언이 반드시 FAIL.

Deno 미설치 → .ts 를 실행하지 않고 소스 텍스트에서 분기를 파싱한다
(test_toss_routing.py · test_edge_checkout_routing.py 와 동일 규약).
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FUNCS = ROOT / "supabase" / "functions"
MIGRATIONS = ROOT / "supabase" / "migrations"

STRIPE_TS = FUNCS / "stripe-webhook" / "index.ts"
TOSS_TS = FUNCS / "toss-webhook" / "index.ts"
APPLE_TS = FUNCS / "billing-apple-notifications" / "index.ts"
GOOGLE_TS = FUNCS / "billing-google-rtdn" / "index.ts"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _billing_branch(src: str) -> str:
    """toss-webhook 의 BILLING_PAYMENT_DONE case 본문 추출 (default: 직전까지)."""
    m = re.search(r"case 'BILLING_PAYMENT_DONE':\s*\{(.*?)\n\s*default:", src, re.DOTALL)
    assert m, "BILLING_PAYMENT_DONE case not found in toss-webhook"
    return m.group(1)


def _strip_stripe_dedup(src: str) -> str:
    """뮤테이션: stripe-webhook 의 dedup claim 블록(if (event.id) {...}) 제거."""
    mutated = re.sub(
        r"\n\s*// \[멱등성\].*?if \(event\.id\) \{.*?\n    \}\n",
        "\n",
        src,
        count=1,
        flags=re.DOTALL,
    )
    assert mutated != src, "mutation no-op: stripe dedup block not found"
    return mutated


# ═══════════════════════════════════════════════════════════════
# §1 Stripe — event.id 원자 claim 게이트 (GAP-1)
# ═══════════════════════════════════════════════════════════════

class TestStripeDedupGate:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(STRIPE_TS)

    def test_claim_inserts_into_shared_ledger(self):
        """billing_events 원장에 stripe_{event.id} 선기록."""
        assert "from('billing_events')" in self.src
        assert "event_id: `stripe_${event.id}`" in self.src
        assert "platform: 'stripe'" in self.src

    def test_claim_after_signature_before_switch(self):
        """위치 불변식: 서명 검증 < claim < 이벤트 분기(switch) — 모든 event type 커버."""
        idx_verify = self.src.index("if (!valid)")
        idx_claim = self.src.index("from('billing_events')")
        idx_switch = self.src.index("switch (event.type)")
        assert idx_verify < idx_claim < idx_switch, (
            "dedup claim 은 서명 검증 직후·switch 이전이어야 한다 "
            "(checkout/subscription.deleted/invoice 전 분기 커버)"
        )

    def test_claim_before_any_mutation(self):
        """claim 이 첫 DB 변이(payments/entitlements/user_entitlements)보다 앞."""
        idx_claim = self.src.index("from('billing_events')")
        for table in ("payments", "entitlements", "user_entitlements", "billing_transactions"):
            idx_write = self.src.index(f"from('{table}')")
            assert idx_claim < idx_write, f"claim 이 {table} 변이보다 뒤에 있다"

    def test_duplicate_returns_200_with_flag(self):
        """중복(23505) → 200 + duplicate:true 즉시 반환 (2xx = Stripe 재전송 중단)."""
        assert "dedupError.code === '23505'" in self.src
        assert "duplicate: true" in self.src
        # duplicate 응답은 status 지정 없음(기본 200) — 4xx/5xx 로 바꾸면 재전송 폭주
        m = re.search(r"duplicate: true \}\), \{ headers", self.src)
        assert m, "duplicate 응답이 기본 200 (status 미지정) 이어야 한다"

    def test_non_duplicate_ledger_failure_is_fail_closed(self):
        """원장 기록 실패(23505 외) → throw(500) — dedup 없이 진행(이중 적립) 금지."""
        assert "throw new Error(`billing_events dedup insert failed" in self.src

    def test_signature_failure_semantics_preserved(self):
        """응답 코드 의미 보존: 서명 실패 = 400 불변."""
        assert "return new Response('Invalid signature', { status: 400 })" in self.src

    def test_replay_tolerance_preserved(self):
        """기존 5분 tolerance 가드 불변 (위조 방지층은 그대로)."""
        assert "> 300" in self.src


# ═══════════════════════════════════════════════════════════════
# §2 Toss — BILLING_PAYMENT_DONE (orderId, paymentKey) 자연키 claim (GAP-4)
# ═══════════════════════════════════════════════════════════════

class TestTossBillingDedupGate:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(TOSS_TS)
        self.branch = _billing_branch(self.src)

    def test_claim_uses_natural_key_in_shared_ledger(self):
        assert "from('billing_events')" in self.branch
        assert "event_id: `toss_billing_${data.orderId}_${data.paymentKey || ''}`" in self.branch
        assert "platform: 'toss'" in self.branch

    def test_claim_before_payment_insert(self):
        """claim 이 payments insert · entitlements 갱신보다 앞 (선기록)."""
        idx_claim = self.branch.index("from('billing_events')")
        assert idx_claim < self.branch.index("from('payments')")
        assert idx_claim < self.branch.index("from('entitlements')")
        assert idx_claim < self.branch.index("from('events')")

    def test_duplicate_returns_200_with_flag(self):
        assert "dedupError.code === '23505'" in self.branch
        assert "duplicate: true" in self.branch

    def test_ledger_failure_is_fail_closed(self):
        assert "throw new Error(`billing_events dedup insert failed" in self.branch

    def test_signature_failure_semantics_preserved(self):
        """응답 코드 의미 보존: 서명 실패 = 401 불변."""
        assert "status: 401" in self.src
        assert "Invalid signature" in self.src

    def test_status_changed_branch_not_gated(self):
        """PAYMENT_STATUS_CHANGED 는 의도적으로 비게이트 — orderId 키로 막으면
        정당한 2차 PARTIAL_CANCELED 를 삼킨다. 변이는 이미 멱등
        (status 동일값 update + entitlements 비활성화는 선조회 status==='confirmed' 게이트)."""
        m = re.search(r"case 'PAYMENT_STATUS_CHANGED':\s*\{(.*?)\n\s*case ", self.src, re.DOTALL)
        assert m, "PAYMENT_STATUS_CHANGED case not found"
        assert "from('billing_events')" not in m.group(1), (
            "PAYMENT_STATUS_CHANGED 에 orderId 기반 dedup 을 넣으면 "
            "부분취소 2회차(동일 orderId)가 유실된다 — 게이트 금지"
        )


# ═══════════════════════════════════════════════════════════════
# §3 공용 원장 불변식 — 재발명 금지 (webhook_events 신설 금지)
# ═══════════════════════════════════════════════════════════════

class TestSharedLedgerInvariant:
    def test_no_duplicate_purpose_webhook_events_table(self):
        """billing_events 가 이미 멱등 원장 — 같은 목적의 webhook_events 신설 금지."""
        for sql in MIGRATIONS.glob("*.sql"):
            src = _read(sql).lower()
            assert not re.search(r"create table.*webhook_events", src), (
                f"{sql.name}: billing_events 와 중복 목적의 webhook_events 테이블 신설 — "
                "재발명 금지 (20260321_billing_schema.sql 의 billing_events 를 공용)"
            )

    def test_ledger_exists_in_migrations(self):
        """공용 원장 billing_events 의 마이그레이션 실존 + event_id PK."""
        schema = _read(MIGRATIONS / "20260321_billing_schema.sql")
        assert "create table if not exists public.billing_events" in schema
        assert re.search(r"event_id\s+text\s+primary key", schema), (
            "billing_events.event_id PK 가 dedup 원자성의 근거 — 변경 금지"
        )

    def test_all_four_webhook_sources_share_ledger(self):
        """stripe/toss/apple/google 4 웹훅 전부 billing_events 를 사용."""
        for ts, platform in (
            (STRIPE_TS, "'stripe'"),
            (TOSS_TS, "'toss'"),
            (APPLE_TS, '"apple"'),
            (GOOGLE_TS, '"google"'),
        ):
            src = _read(ts)
            assert "billing_events" in src, f"{ts.parent.name} 가 공용 원장 미사용"
            assert f"platform: {platform}" in src, f"{ts.parent.name} platform 라벨 누락"

    def test_event_id_namespaces_distinct(self):
        """원장 공유 시 소스별 event_id prefix 네임스페이스 충돌 금지."""
        prefixes = {
            "stripe_": _read(STRIPE_TS),
            "toss_billing_": _read(TOSS_TS),
            "apple_notif_": _read(APPLE_TS),
            "google_rtdn_": _read(GOOGLE_TS),
        }
        for prefix, src in prefixes.items():
            assert prefix in src, f"event_id prefix {prefix} 누락"


# ═══════════════════════════════════════════════════════════════
# §4 뮤테이션 입증 — dedup 제거 시 단언이 깨진다 (변경 민감성)
# ═══════════════════════════════════════════════════════════════

class TestMutationProof:
    def test_stripe_dedup_removal_is_caught(self):
        """GAP-1 되돌림(claim 블록 삭제) 재현 → §1 위치 단언이 반드시 FAIL."""
        src = _read(STRIPE_TS)
        mutated = _strip_stripe_dedup(src)
        with pytest.raises(ValueError):
            # claim 이 사라지면 index() 가 ValueError — 게이트 부재 검출
            mutated.index("from('billing_events')")

    def test_toss_dedup_removal_is_caught(self):
        """GAP-4 되돌림(BILLING claim 삭제) 재현 → §2 단언이 반드시 FAIL."""
        src = _read(TOSS_TS)
        mutated = re.sub(
            r"\n\s*// \[멱등성\].*?throw new Error\(`billing_events dedup insert failed: \$\{dedupError\.message\}`\)\n\s*\}\n",
            "\n",
            src,
            count=1,
            flags=re.DOTALL,
        )
        assert mutated != src, "mutation no-op: toss dedup block not found"
        assert "from('billing_events')" not in _billing_branch(mutated)

    def test_stripe_duplicate_flag_mutation_is_caught(self):
        """duplicate:true 응답을 제거하면 §1 단언이 깨진다."""
        src = _read(STRIPE_TS)
        mutated = src.replace("duplicate: true", "ok: true", 1)
        assert mutated != src
        with pytest.raises(AssertionError):
            assert "duplicate: true" in mutated
