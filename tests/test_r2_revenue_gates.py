"""
R2 수익/권한 게이트 회귀 테스트 (2026-06-23)
=============================================================================

R2 brief 의 다음 결함 수정을 코드 파싱으로 불변식 고정한다.
Deno/DB 미실행 환경 → .ts/.js 소스 텍스트 파싱(money_path 패턴 동일).

  [4] monthly_report = Plus 구독 전용 → openai-proxy 서버 게이트 + 클라 사전 페이월.
  [5] dream_detail 게이트 = 구독 확인 먼저 → 구독자 팩 크레딧 차감 금지(순서).
  [6] events 테이블 insert = props 키 사용(properties 는 events 에 존재하지 않는 컬럼).
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FUNCS = ROOT / "supabase" / "functions"
SRC = ROOT / "src"

OPENAI_PROXY_TS = FUNCS / "openai-proxy" / "index.ts"
MONTHLY_JS = SRC / "tabs" / "my-monthly-report.js"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════
# [4] monthly_report 구독 게이트 (서버 단일 권위)
# ══════════════════════════════════════════════════════════════════════

class TestMonthlyReportSubscriptionGate:
    """monthly_report LLM task 는 서버에서 구독자만 통과(무료 LLM 비용 누수 차단)."""

    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(OPENAI_PROXY_TS)

    def _monthly_gate_block(self) -> str:
        """if (task === 'monthly_report') { ... } 부터 buildChatPayload 직전까지."""
        m = re.search(
            r"if \(task === 'monthly_report'\)\s*\{(.+?)(?=const builtPayload)",
            self.src, re.DOTALL,
        )
        assert m, "monthly_report 서버 게이트 블록(buildChatPayload 직전)을 찾을 수 없다"
        return m.group(1)

    def test_monthly_report_gate_exists(self):
        assert "task === 'monthly_report'" in self.src, (
            "openai-proxy 에 monthly_report 게이트 분기가 없다 — 유료 기능 무료 노출(LLM 비용 누수)"
        )

    def test_monthly_report_gate_before_build_payload(self):
        idx_gate = self.src.index("task === 'monthly_report'")
        idx_build = self.src.index("buildChatPayload(task, params)")
        assert idx_gate < idx_build, (
            "monthly_report 게이트가 buildChatPayload 이후 — LLM 호출 전 차단 불가"
        )

    def test_monthly_report_gate_checks_subscription(self):
        block = self._monthly_gate_block()
        assert "has_subscription" in block and "check_entitlement" in block, (
            "monthly_report 게이트가 구독 여부(check_entitlement.has_subscription)를 확인하지 않는다"
        )

    def test_monthly_report_gate_returns_403_on_non_subscriber(self):
        block = self._monthly_gate_block()
        assert "status: 403" in block, (
            "비구독자에게 403(fail-closed)을 반환하지 않는다"
        )

    def test_monthly_report_gate_does_not_deduct_pack_credit(self):
        """구독 전용 기능 → 게이트에서 use_credit() 차감을 호출하면 안 된다."""
        block = self._monthly_gate_block()
        assert "use_credit" not in block, (
            "monthly_report 게이트가 use_credit() 을 호출 — 구독 전용 기능에서 팩 크레딧 차감은 부적절"
        )

    def test_client_prechecks_tier_before_calling(self):
        """클라(my-monthly-report.js)가 LLM 호출 전 구독 tier 를 사전 확인하고 비구독자는 페이월."""
        js = _read(MONTHLY_JS)
        # callChat('monthly_report' 호출 위치
        idx_call = js.index("callChat('monthly_report'")
        head = js[:idx_call]
        assert "getCachedTier" in head, (
            "callChat('monthly_report') 이전에 getCachedTier() 사전 체크가 없다"
        )
        assert "showPaywall" in head, (
            "비구독자에게 정직한 페이월(showPaywall) 경로가 없다"
        )


# ══════════════════════════════════════════════════════════════════════
# [5] dream_detail 게이트: 구독 확인 먼저 → 구독자 팩 크레딧 차감 금지
# ══════════════════════════════════════════════════════════════════════

class TestDreamDetailSubscriptionFirst:
    """구독자(plus/premium)는 보유 팩 크레딧이 dream_detail 마다 차감되면 안 된다."""

    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(OPENAI_PROXY_TS)

    def _gate_block(self) -> str:
        m = re.search(
            r"if \(task === 'dream_detail'\)\s*\{(.+?)(?=const builtPayload|// \[보안 P1)",
            self.src, re.DOTALL,
        )
        assert m, "dream_detail 게이트 블록을 찾을 수 없다"
        return m.group(1)

    def test_subscription_check_before_use_credit(self):
        """check_entitlement(구독 확인)이 use_credit(차감)보다 먼저 호출돼야 한다."""
        block = self._gate_block()
        idx_sub = block.find("check_entitlement")
        idx_credit = block.find("use_credit")
        assert idx_sub != -1, "dream_detail 게이트에 check_entitlement 확인이 없다"
        assert idx_credit != -1, "dream_detail 게이트에 use_credit 차감이 없다"
        assert idx_sub < idx_credit, (
            "check_entitlement(구독 확인)이 use_credit(차감)보다 뒤에 있다 — "
            "구독자라도 팩 크레딧이 먼저 차감됨(결함 [5])"
        )

    def test_use_credit_guarded_by_non_subscriber(self):
        """use_credit() 호출이 !hasSub 분기 안에 있어야(구독자는 차감 건너뜀)."""
        block = self._gate_block()
        m = re.search(r"if\s*\(!hasSub\)\s*\{(.+?)\}\s*\}?\s*$", block, re.DOTALL)
        # 견고화: !hasSub 블록 안에 use_credit 가 위치하는지 텍스트 근접도로 확인
        idx_guard = block.find("!hasSub")
        idx_credit = block.find("use_credit")
        assert idx_guard != -1, "비구독자 분기(!hasSub)가 없다 — 구독자도 차감 경로 진입"
        assert idx_guard < idx_credit, (
            "use_credit() 이 비구독자(!hasSub) 가드보다 앞 — 구독자도 차감됨"
        )

    def test_gate_still_returns_403_fail_closed(self):
        """비구독자 + 크레딧 없음 → 여전히 403(우회 방지 유지)."""
        block = self._gate_block()
        assert "status: 403" in block, (
            "fail-closed 403 분기가 사라졌다 — 무료 우회 회귀"
        )


# ══════════════════════════════════════════════════════════════════════
# [6] events insert = props 컬럼 (properties 는 events 에 없음)
# ══════════════════════════════════════════════════════════════════════

class TestEventsInsertUsesPropsColumn:
    """events 테이블 정본 컬럼은 props. insert 가 properties 키를 쓰면 PostgREST 거부."""

    EVENTS_INSERT_SITES = [
        SRC / "services" / "analytics.js",
        SRC / "services" / "growth.js",
        FUNCS / "stripe-webhook" / "index.ts",
        FUNCS / "toss-confirm" / "index.ts",
        FUNCS / "toss-webhook" / "index.ts",
        FUNCS / "push-scheduler" / "index.ts",
    ]

    def _events_insert_payloads(self, src: str):
        """from('events').insert({ ... }) 의 페이로드 본문들을 추출(중첩 1단계 균형)."""
        payloads = []
        for m in re.finditer(r"from\('events'\)\s*\.insert\(\s*\{", src):
            start = src.index("{", m.start())
            depth = 0
            i = start
            while i < len(src):
                if src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                    if depth == 0:
                        payloads.append(src[start:i + 1])
                        break
                i += 1
        return payloads

    def test_events_inserts_use_props_key(self):
        offenders = []
        total_payloads = 0
        for f in self.EVENTS_INSERT_SITES:
            src = _read(f)
            payloads = self._events_insert_payloads(src)
            total_payloads += len(payloads)
            for pl in payloads:
                # 페이로드의 '객체 키' 위치(줄머리/{/, 다음)에 properties: 가 있으면 잘못된 컬럼명.
                #   (ternary 의 'x ? properties : y' 같은 '값' 위치는 제외 — props 변수 참조는 정상)
                if re.search(r"(?:^|[{,])\s*properties\s*:", pl):
                    offenders.append(f"{f.name}: {pl[:80]}")
        assert total_payloads >= 7, (
            f"events insert 사이트가 예상(7)보다 적게 탐지됨({total_payloads}) — 추출 로직/대상 점검"
        )
        assert not offenders, (
            "events insert 가 존재하지 않는 컬럼 properties 를 사용(정본=props):\n"
            + "\n".join(offenders)
        )

    def test_funnel_events_still_uses_properties(self):
        """대비군: funnel_events 정본 컬럼은 properties → 잘못 바꾸지 않았는지 확인."""
        funnel = SRC / "utils" / "funnel.js"
        if not funnel.is_file():
            pytest.skip("funnel.js 없음")
        src = _read(funnel)
        if "funnel_events" in src and ".insert(" in src:
            # funnel_events insert 가 props 로 잘못 바뀌지 않았는지(정본=properties)
            for m in re.finditer(r"from\('funnel_events'\)\s*\.insert", src):
                seg = src[m.start():m.start() + 400]
                assert "properties" in seg or "props" not in seg, (
                    "funnel_events insert 가 props 로 바뀜 — funnel_events 정본은 properties"
                )
