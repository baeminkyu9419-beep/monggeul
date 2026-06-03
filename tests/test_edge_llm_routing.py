"""
MONGGEUL Edge Function LLM 라우팅 — 변경 민감(change-sensitive) 단위 테스트
================================================================================

배경 (왜 이 파일이 존재하나):
  꿈 해몽의 실제 AI 산출은 supabase/functions/openai-proxy/index.ts 의
  PROVIDERS 배열 + _chatFallback 라우팅으로 결정된다. 멀티 LLM 키 중
  현재 라이브는 Mistral(주)·Gemini(폴백) 둘뿐(OpenAI/DeepSeek 죽음).
  따라서 라우팅 1차 = Mistral 이 보장돼야 키 없는/죽은 provider 헛호출 없이
  첫 시도에서 실 해몽이 나온다. 이 순서가 깨지면(예: 죽은 OpenAI 가 다시
  enabled 거나 배열 맨 앞으로 이동) 매 해몽이 401→폴백 = 지연·실패 위험.

이 파일은 그 라우팅 계약을 소스에서 직접 파싱해 단언한다:
  1) PROVIDERS 배열을 .ts 소스에서 파싱(name/enabled/compatible 순서 보존).
  2) "활성(enabled && key 주입 가정) 중 1차 = mistral" 을 단언.
  3) 죽은 provider(openai) 는 enabled:false 로 라우팅에서 제외됨을 단언.
  4) 뮤테이션 입증: Mistral 을 비활성화하거나 OpenAI 를 1차로 끌어올리면
     위 단언이 반드시 FAIL 한다 = 이 테스트는 변경에 민감하다.

Deno 미설치 → .ts 를 직접 실행하지 않고 PROVIDERS 선언을 텍스트 파싱해
모델링한다(test_edge_checkout_routing.py 와 동일한 전략). 순수 파일 기반.
"""

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROXY_TS = ROOT / "supabase" / "functions" / "openai-proxy" / "index.ts"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


# ═══════════════════════════════════════════════════════════════
# openai-proxy/index.ts — PROVIDERS 배열 파싱
# ═══════════════════════════════════════════════════════════════

def parse_providers(src: str) -> list[dict]:
    """const PROVIDERS: Provider[] = [ {name:..., enabled:...}, ... ] 파싱.

    배열 순서 = 라우팅 우선순위이므로 순서를 보존한다.
    각 원소에서 name(문자열)·enabled(불리언)·compatible(불리언)을 추출.
    """
    m = re.search(r"PROVIDERS\s*:\s*Provider\[\]\s*=\s*\[(.*?)\n\]", src, re.DOTALL)
    assert m, "PROVIDERS array not found in openai-proxy/index.ts"
    body = m.group(1)
    providers = []
    # 각 { ... } 원소 (한 줄당 1 provider 라는 현행 포맷 가정 + 일반 중괄호 매칭)
    for obj in re.findall(r"\{[^{}]*\}", body):
        name_m = re.search(r"name\s*:\s*'([^']+)'", obj)
        if not name_m:
            continue
        enabled_m = re.search(r"enabled\s*:\s*(true|false)", obj)
        compat_m = re.search(r"compatible\s*:\s*(true|false)", obj)
        providers.append({
            "name": name_m.group(1),
            "enabled": (enabled_m.group(1) == "true") if enabled_m else None,
            "compatible": (compat_m.group(1) == "true") if compat_m else None,
        })
    return providers


def active_providers(src: str) -> list[dict]:
    """_chatFallback = PROVIDERS.filter(p => p.key && p.enabled).

    키 주입은 런타임이므로 여기선 'enabled === true' 인 provider 만 활성 후보로
    모델링한다(순서 보존). 죽은 키로 비활성한 provider 는 제외됨을 반영.
    """
    return [p for p in parse_providers(src) if p["enabled"] is True]


# ── 뮤테이션(라우팅 회귀 재현) ────────────────────────────────────

def mutate_disable_mistral(src: str) -> str:
    """Mistral 을 enabled:false 로 비활성화 → 1차가 더 이상 mistral 이 아님."""
    mutated = re.sub(
        r"(name:\s*'mistral'[^\n]*enabled:\s*)true",
        r"\1false",
        src,
        count=1,
    )
    assert mutated != src, "mutation no-op: mistral enabled:true not found"
    return mutated


def mutate_enable_openai_first(src: str) -> str:
    """죽은 OpenAI 를 enabled:true 로 되살리고 배열 맨 앞으로 끌어올리는 회귀 재현.

    단순화: openai 줄을 enabled:true 로 바꾸고 mistral 줄 앞으로 이동.
    """
    lines = src.split("\n")
    out, openai_line = [], None
    for ln in lines:
        if re.search(r"name:\s*'openai'", ln):
            openai_line = re.sub(r"enabled:\s*false", "enabled: true", ln)
            continue
        out.append(ln)
    assert openai_line is not None, "openai provider line not found"
    # mistral 줄 앞에 openai 삽입
    final = []
    inserted = False
    for ln in out:
        if not inserted and re.search(r"name:\s*'mistral'", ln):
            final.append(openai_line)
            inserted = True
        final.append(ln)
    assert inserted, "mistral line not found for reinsertion"
    return "\n".join(final)


# ═══════════════════════════════════════════════════════════════
# TESTS — PROVIDERS 라우팅 순서/활성화 계약
# ═══════════════════════════════════════════════════════════════

class TestProviderRoutingOrder:
    @pytest.fixture(autouse=True)
    def _src(self):
        self.src = _read(PROXY_TS)

    def test_providers_array_parsed(self):
        """PROVIDERS 배열이 파싱되고 핵심 4 provider 가 선언돼 있다."""
        names = [p["name"] for p in parse_providers(self.src)]
        assert "mistral" in names
        assert "gemini" in names
        assert "openai" in names
        # 순서 보존: 배열 첫 원소 = mistral (라우팅 1차)
        assert names[0] == "mistral", f"first provider must be mistral, got {names}"

    def test_mistral_is_first_active_provider(self):
        """라이브 라우팅 1차 = Mistral (현재 유일하게 안정 라이브, SAJU 선례)."""
        active = active_providers(self.src)
        assert active, "no active providers (all enabled:false?)"
        assert active[0]["name"] == "mistral", (
            f"first ACTIVE provider must be mistral, got {[p['name'] for p in active]}"
        )

    def test_dead_openai_is_disabled_in_routing(self):
        """죽은 OpenAI 키 → enabled:false 로 라우팅 제외(매 호출 401 헛호출 차단)."""
        providers = {p["name"]: p for p in parse_providers(self.src)}
        assert providers["openai"]["enabled"] is False, (
            "openai must stay enabled:false until a valid key is provisioned"
        )

    def test_mistral_uses_openai_compatible_api(self):
        """Mistral = OpenAI 호환(compatible:true) → _callProvider 호환 분기로 처리."""
        providers = {p["name"]: p for p in parse_providers(self.src)}
        assert providers["mistral"]["compatible"] is True

    def test_gemini_is_fallback_active(self):
        """Gemini = 2차 폴백으로 활성(Mistral 실패 시 자동 폴백)."""
        active = [p["name"] for p in active_providers(self.src)]
        assert "gemini" in active, "gemini must remain an active fallback"
        # gemini 는 mistral 다음 순서(1차 아님)
        assert active.index("gemini") > active.index("mistral")


# ═══════════════════════════════════════════════════════════════
# TESTS — 뮤테이션 입증 (변경 민감성)
# ═══════════════════════════════════════════════════════════════

class TestRoutingMutationProof:
    """라우팅 순서를 깨는 회귀를 재현하면 위 단언이 실제로 FAIL = 변경에 민감하다."""

    def test_disabling_mistral_breaks_first_active_assertion(self):
        src = _read(PROXY_TS)
        mutated = mutate_disable_mistral(src)
        # 정상: 1차 활성 = mistral
        assert active_providers(src)[0]["name"] == "mistral"
        # 회귀: mistral 비활성 → 1차가 더 이상 mistral 아님
        assert active_providers(mutated)[0]["name"] != "mistral"
        with pytest.raises(AssertionError):
            assert active_providers(mutated)[0]["name"] == "mistral", (
                "regression: mistral 이 더 이상 1차 활성 provider 아님"
            )

    def test_promoting_dead_openai_to_first_breaks_assertion(self):
        src = _read(PROXY_TS)
        mutated = mutate_enable_openai_first(src)
        # 정상: 1차 활성 = mistral
        assert active_providers(src)[0]["name"] == "mistral"
        # 회귀: 죽은 openai 를 1차로 되살림 → 매 호출 401 헛호출 위험
        assert active_providers(mutated)[0]["name"] == "openai"
        with pytest.raises(AssertionError):
            assert active_providers(mutated)[0]["name"] == "mistral"
