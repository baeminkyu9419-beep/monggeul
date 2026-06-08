"""
MONGGEUL — analyzeDream() paywall gate 배선 검증
뮤테이션 정신: 이 테스트들은 게이트 배선 전 코드라면 FAIL, 배선 후 PASS.

검증 대상:
  - canUseDream() 호출이 analyzeDream() 본문에 존재
  - 게이트 미통과 시 showPaywall() 호출 경로 연결
  - reason 기반 분기(guest_limit, daily_limit)
  - 로컬 폴백(getDreamCountLocal) 구조가 Supabase 없이 작동
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
TABS = SRC / "tabs"
SERVICES = SRC / "services"


# ─────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def dream_src():
    return (TABS / "dream.js").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def sub_src():
    return (SERVICES / "subscription.js").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────────
# 1. canUseDream() 게이트 배선 — 핵심 뮤테이션 테스트
# ─────────────────────────────────────────────────────────────────

class TestCanUseDreamGateWired:
    """게이트 배선 검증 — 배선 전 코드라면 전부 FAIL"""

    def test_canUseDream_called_in_analyzeDream(self, dream_src):
        """analyzeDream() 내부에서 canUseDream()을 await 호출해야 한다.
        배선 전 코드: import만 있고 호출 없음 → FAIL.
        배선 후 코드: await canUseDream() 존재 → PASS."""
        # analyzeDream 함수 본문만 추출
        m = re.search(
            r"export async function analyzeDream\(\)\s*\{([\s\S]*?)^\}",
            dream_src,
            re.MULTILINE,
        )
        assert m, "analyzeDream 함수를 찾을 수 없습니다"
        body = m.group(1)
        assert "canUseDream" in body, (
            "analyzeDream() 내부에서 canUseDream()을 호출해야 합니다 — "
            "import만 있고 호출이 없으면 paywall이 발동하지 않습니다"
        )
        assert "await canUseDream" in body, (
            "canUseDream()은 async 함수이므로 반드시 await 해야 합니다"
        )

    def test_gate_checks_allowed_field(self, dream_src):
        """canUseDream() 반환값의 .allowed 를 체크해야 한다."""
        m = re.search(
            r"export async function analyzeDream\(\)\s*\{([\s\S]*?)^\}",
            dream_src,
            re.MULTILINE,
        )
        assert m, "analyzeDream 함수를 찾을 수 없습니다"
        body = m.group(1)
        # .allowed 체크 패턴: _gate.allowed, gate.allowed, etc.
        assert re.search(r"\.allowed", body), (
            "canUseDream() 결과의 .allowed 필드를 검사해야 합니다"
        )

    def test_gate_calls_showPaywall_on_denied(self, dream_src):
        """게이트 미통과 시 showPaywall()을 호출해야 한다."""
        m = re.search(
            r"export async function analyzeDream\(\)\s*\{([\s\S]*?)^\}",
            dream_src,
            re.MULTILINE,
        )
        assert m, "analyzeDream 함수를 찾을 수 없습니다"
        body = m.group(1)
        assert "showPaywall" in body, (
            "게이트 미통과 시 showPaywall()로 결제 유도해야 합니다"
        )

    def test_gate_returns_early_on_denied(self, dream_src):
        """게이트 미통과 시 함수를 조기 return 해야 한다 (LLM 호출 방지).

        구현 패턴:
          if(!_gate.allowed){
            ...
            showPaywall(...)
            return;          ← 이게 있어야 LLM 호출 차단됨
          }
        """
        m = re.search(
            r"export async function analyzeDream\(\)\s*\{([\s\S]*?)^\}",
            dream_src,
            re.MULTILINE,
        )
        assert m, "analyzeDream 함수를 찾을 수 없습니다"
        body = m.group(1)

        # 1) !allowed 분기가 존재해야 함
        assert re.search(r"if\s*\(!.*?allowed", body), (
            "게이트 미통과 분기 if(!...allowed)가 없습니다"
        )

        # 2) showPaywall 과 return 이 가까이(200자 이내) 있어야 한다.
        #    중첩 브레이스 regex 대신 텍스트 근접도로 검사 (더 견고함).
        pw_idx = body.find("showPaywall")
        ret_idx = body.find("return", pw_idx)
        assert pw_idx != -1, "showPaywall 호출이 없습니다"
        assert ret_idx != -1, "showPaywall 이후 return이 없습니다"
        assert ret_idx - pw_idx < 200, (
            f"showPaywall({pw_idx})과 return({ret_idx}) 사이가 너무 멀어요 "
            "— 게이트 블록 밖에서 return 하는 것으로 보입니다"
        )

    def test_gate_placed_before_busy_flag(self, dream_src):
        """canUseDream 게이트는 _busy 플래그 설정보다 앞에 있어야 한다.
        busy=true 이후에 gate 하면 거부 시 busy 상태가 해제되지 않는다."""
        can_idx = dream_src.find("await canUseDream")
        busy_idx = dream_src.find("analyzeDream._busy=true")
        assert can_idx != -1, "await canUseDream 호출이 없습니다"
        assert busy_idx != -1, "analyzeDream._busy=true 가 없습니다"
        assert can_idx < busy_idx, (
            "canUseDream() 게이트는 _busy=true 설정보다 앞에 있어야 합니다. "
            f"현재 canUseDream at {can_idx}, _busy=true at {busy_idx}"
        )

    def test_gate_passes_reason_to_showPaywall(self, dream_src):
        """showPaywall()에 reason(guest_limit / daily_limit)을 전달해야 한다."""
        m = re.search(
            r"export async function analyzeDream\(\)\s*\{([\s\S]*?)^\}",
            dream_src,
            re.MULTILINE,
        )
        assert m, "analyzeDream 함수를 찾을 수 없습니다"
        body = m.group(1)
        # showPaywall(_gate.reason) 또는 showPaywall(reason) 형태
        assert re.search(r"showPaywall\s*\(.*reason", body), (
            "showPaywall()에 reason을 전달해야 guest/daily 분기 메시지가 다르게 표시됩니다"
        )


# ─────────────────────────────────────────────────────────────────
# 2. canUseDream() 로직 — Supabase 없이 로컬 폴백 작동
# ─────────────────────────────────────────────────────────────────

class TestCanUseDreamLocalFallback:
    """Supabase 없이 getDreamCountLocal 로컬 폴백이 구조적으로 작동함을 검증"""

    def test_canUseDream_exported(self, sub_src):
        """canUseDream이 export function으로 정의되어야 한다"""
        assert "export async function canUseDream" in sub_src, \
            "canUseDream이 export되지 않았습니다"

    def test_getDreamCountLocal_is_supabase_free(self, sub_src):
        """getDreamCountLocal은 localStorage만 사용하고 supabase를 참조하지 않아야 한다"""
        # getDreamCountLocal 함수 본문 추출
        m = re.search(
            r"export function getDreamCountLocal\(\)\s*\{([^}]+)\}",
            sub_src,
        )
        assert m, "getDreamCountLocal 함수를 찾을 수 없습니다"
        body = m.group(1)
        assert "localStorage" in body, "getDreamCountLocal은 localStorage를 사용해야 합니다"
        assert "supabase" not in body.lower(), \
            "getDreamCountLocal은 Supabase를 호출하면 안 됩니다 (로컬 폴백 역할)"

    def test_getDreamCountAsync_fallback_to_local(self, sub_src):
        """getDreamCountAsync는 Supabase 실패/미연결 시 getDreamCountLocal로 폴백해야 한다"""
        m = re.search(
            r"export async function getDreamCountAsync\(\)\s*\{([\s\S]*?)^}",
            sub_src,
            re.MULTILINE,
        )
        assert m, "getDreamCountAsync 함수를 찾을 수 없습니다"
        body = m.group(1)
        assert "getDreamCountLocal" in body, \
            "getDreamCountAsync가 getDreamCountLocal 폴백을 호출해야 합니다"

    def test_canUseDream_has_guest_path(self, sub_src):
        """비로그인(guest) 경로가 canUseDream 안에 있어야 한다"""
        assert "guest_limit" in sub_src, \
            "canUseDream에 guest_limit reason이 없습니다"

    def test_canUseDream_has_daily_limit_path(self, sub_src):
        """일일 한도 초과 경로가 canUseDream 안에 있어야 한다"""
        assert "daily_limit" in sub_src, \
            "canUseDream에 daily_limit reason이 없습니다"

    def test_daily_free_limit_constant_defined(self, sub_src):
        """DAILY_FREE_LIMIT 상수가 정의되어야 한다"""
        assert "DAILY_FREE_LIMIT" in sub_src, \
            "DAILY_FREE_LIMIT 상수가 없습니다"


# ─────────────────────────────────────────────────────────────────
# 3. showPaywall feature map — guest_limit / daily_limit 분기
# ─────────────────────────────────────────────────────────────────

class TestPaywallFeatureMap:
    """showPaywall이 reason 별로 다른 메시지를 보여줄 수 있는지 검증"""

    @pytest.fixture(autouse=True)
    def load(self):
        self.paywall_src = (SRC / "components" / "paywall.js").read_text(encoding="utf-8")

    def test_showPaywall_handles_guest_limit(self):
        """showPaywall('guest_limit') 경로가 존재해야 한다"""
        assert "guest_limit" in self.paywall_src, \
            "paywall.js에 guest_limit 메시지가 없습니다"

    def test_showPaywall_handles_daily_limit(self):
        """showPaywall('daily_limit') 경로가 존재해야 한다"""
        assert "daily_limit" in self.paywall_src, \
            "paywall.js에 daily_limit 메시지가 없습니다"

    def test_guest_limit_message_has_login_cta(self):
        """guest_limit 메시지는 로그인 CTA를 포함해야 한다"""
        m = re.search(r"guest_limit\s*:\s*\{([^}]+)\}", self.paywall_src, re.DOTALL)
        assert m, "guest_limit 메시지 블록을 찾을 수 없습니다"
        block = m.group(1)
        assert "로그인" in block, "guest_limit 페이월에 로그인 CTA가 없습니다"

    def test_daily_limit_message_has_premium_cta(self):
        """daily_limit 메시지는 프리미엄/상세해몽 CTA를 포함해야 한다"""
        m = re.search(r"daily_limit\s*:\s*\{([^}]+)\}", self.paywall_src, re.DOTALL)
        assert m, "daily_limit 메시지 블록을 찾을 수 없습니다"
        block = m.group(1)
        assert "상세 해몽" in block or "프리미엄" in block or "premium" in block.lower(), \
            "daily_limit 페이월에 유료 업셀 CTA가 없습니다"
