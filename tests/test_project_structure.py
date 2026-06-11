"""MONGGEUL 프로젝트 구조 검증 테스트

7-Lane Architecture 기준으로 src/ 디렉토리 구조 검증.
- Main: app.js, store.js
- Input: services/ (꿈 입력, 음성, 데이터 수집)
- Logic: utils/, services/dream-pattern.js (해석 엔진, 패턴 분석)
- Output: components/, tabs/ (UI, 결과 표시)
- Extend: services/community-*, services/dali (달이, 커뮤니티)
- Verify: tests/ (이 파일)
"""

import pathlib
import pytest

# [2026-06-03] 독립 repo(C:/Dev/monggeul) self-contained 화 — 하드코딩 외부경로
#   C:\JARVIS_NEW\projects\MONGGEUL 는 스테일 구버전(git HEAD 불일치)을 가리켜
#   본 repo 가 아닌 외부 복사본을 검증하던 결함. 다른 테스트 파일과 동일하게
#   __file__ 기준 상대경로로 정정(이 파일은 tests/ 직하 → repo root = parent.parent).
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


# ═══════════════════════════════════════════════════════════════
# 1. 디렉토리 구조 존재 검증
# ═══════════════════════════════════════════════════════════════

class TestDirectoryStructure:
    """src/ 하위 필수 디렉토리 존재 확인"""

    def test_src_exists(self):
        assert SRC.is_dir(), "src/ 디렉토리가 없습니다"

    def test_services_dir(self):
        assert (SRC / "services").is_dir(), "src/services/ 디렉토리가 없습니다"

    def test_utils_dir(self):
        assert (SRC / "utils").is_dir(), "src/utils/ 디렉토리가 없습니다"

    def test_tabs_dir(self):
        assert (SRC / "tabs").is_dir(), "src/tabs/ 디렉토리가 없습니다"

    def test_components_dir(self):
        assert (SRC / "components").is_dir(), "src/components/ 디렉토리가 없습니다"

    def test_styles_dir(self):
        assert (SRC / "styles").is_dir(), "src/styles/ 디렉토리가 없습니다"

    def test_tests_dir(self):
        assert (ROOT / "tests").is_dir(), "tests/ 디렉토리가 없습니다"


# ═══════════════════════════════════════════════════════════════
# 2. 핵심 진입점 파일
# ═══════════════════════════════════════════════════════════════

class TestCoreEntryFiles:
    """Main lane 핵심 파일"""

    def test_app_js_exists(self):
        assert (SRC / "app.js").is_file(), "src/app.js 진입점이 없습니다"

    def test_store_js_exists(self):
        assert (SRC / "store.js").is_file(), "src/store.js 상태 저장소가 없습니다"

    def test_index_html_exists(self):
        assert (ROOT / "index.html").is_file(), "index.html 진입점이 없습니다"

    def test_vite_config_exists(self):
        assert (ROOT / "vite.config.js").is_file(), "vite.config.js 빌드 설정이 없습니다"


# ═══════════════════════════════════════════════════════════════
# 3. 탭 모듈 (Output lane — 4개 핵심 탭)
# ═══════════════════════════════════════════════════════════════

class TestTabModules:
    """해몽/달이/커뮤니티/MY 4개 핵심 탭 존재 확인"""

    @pytest.mark.parametrize("tab", ["dream.js", "dali.js", "community.js", "my.js"])
    def test_core_tab_exists(self, tab):
        assert (SRC / "tabs" / tab).is_file(), f"src/tabs/{tab}이 없습니다"


# ═══════════════════════════════════════════════════════════════
# 4. 서비스 모듈 (Input/Logic/Extend lanes)
# ═══════════════════════════════════════════════════════════════

class TestServiceModules:
    """핵심 서비스 파일 존재 확인"""

    REQUIRED_SERVICES = [
        "api.js",              # OpenAI 프록시 호출
        "auth.js",             # Supabase Auth
        "subscription.js",     # 구독/크레딧 관리
        "payment.js",          # 결제 시스템
        "analytics.js",        # 이벤트 로깅
        "dream-pattern.js",    # 꿈 패턴 엔진 (마르코프)
        "dream-context.js",    # 꿈 맥락 CRM
    ]

    @pytest.mark.parametrize("service", REQUIRED_SERVICES)
    def test_service_exists(self, service):
        assert (SRC / "services" / service).is_file(), f"src/services/{service}이 없습니다"


# ═══════════════════════════════════════════════════════════════
# 5. 유틸리티 모듈 (Logic lane)
# ═══════════════════════════════════════════════════════════════

class TestUtilModules:
    """유틸리티 모듈 존재 확인"""

    REQUIRED_UTILS = [
        "emotion.js",     # 감정 감지 규칙 75+
        "symbols.js",     # 꿈 상징 사전
        "sanitize.js",    # XSS 방지
    ]

    @pytest.mark.parametrize("util", REQUIRED_UTILS)
    def test_util_exists(self, util):
        assert (SRC / "utils" / util).is_file(), f"src/utils/{util}이 없습니다"


# ═══════════════════════════════════════════════════════════════
# 6. 컴포넌트 모듈 (Output lane)
# ═══════════════════════════════════════════════════════════════

class TestComponentModules:
    """재사용 UI 컴포넌트 존재 확인"""

    REQUIRED_COMPONENTS = [
        "paywall.js",     # 결제 모달
        "radar.js",       # 레이더 차트
        "toast.js",       # 토스트 알림
    ]

    @pytest.mark.parametrize("comp", REQUIRED_COMPONENTS)
    def test_component_exists(self, comp):
        assert (SRC / "components" / comp).is_file(), f"src/components/{comp}이 없습니다"


# ═══════════════════════════════════════════════════════════════
# 7. 비즈니스 로직 위치 정합성
# ═══════════════════════════════════════════════════════════════

class TestBusinessLogicPlacement:
    """비즈니스 로직이 올바른 레인에 위치하는지 확인"""

    def test_dream_interpretation_in_tabs(self):
        """해몽 로직은 tabs/dream.js에 위치"""
        dream = (SRC / "tabs" / "dream.js").read_text(encoding="utf-8")
        assert "해몽" in dream or "interpret" in dream.lower(), "해몽 로직이 tabs/dream.js에 없습니다"

    def test_dali_ai_in_tabs(self):
        """달이 AI는 tabs/dali.js에 위치"""
        dali = (SRC / "tabs" / "dali.js").read_text(encoding="utf-8")
        assert "달이" in dali or "dali" in dali.lower(), "달이 로직이 tabs/dali.js에 없습니다"

    def test_emotion_rules_in_utils(self):
        """감정 규칙은 utils/emotion.js에 위치"""
        emotion = (SRC / "utils" / "emotion.js").read_text(encoding="utf-8")
        assert "EMOTION_RULES" in emotion, "감정 규칙이 utils/emotion.js에 없습니다"

    def test_pattern_engine_in_services(self):
        """패턴 엔진은 services/dream-pattern.js에 위치"""
        pattern = (SRC / "services" / "dream-pattern.js").read_text(encoding="utf-8")
        assert "마르코프" in pattern or "Markov" in pattern or "classifyEmotion" in pattern, (
            "패턴 엔진이 services/dream-pattern.js에 없습니다"
        )

    def test_subscription_logic_in_services(self):
        """구독 로직은 services/subscription.js에 위치"""
        sub = (SRC / "services" / "subscription.js").read_text(encoding="utf-8")
        assert "canUseDream" in sub, "구독 로직이 services/subscription.js에 없습니다"

    def test_payment_logic_in_services(self):
        """결제 로직은 services/payment.js에 위치"""
        pay = (SRC / "services" / "payment.js").read_text(encoding="utf-8")
        assert "checkout" in pay.lower(), "결제 로직이 services/payment.js에 없습니다"


# ═══════════════════════════════════════════════════════════════
# 8. 설정 / 빌드 파일
# ═══════════════════════════════════════════════════════════════

class TestConfigFiles:
    """프로젝트 설정 파일 존재 확인"""

    def test_package_json(self):
        assert (ROOT / "package.json").is_file()

    def test_config_js(self):
        assert (ROOT / "config.js").is_file(), "config.js (Supabase URL + anon key) 없음"

    def test_capacitor_config(self):
        assert (ROOT / "capacitor.config.json").is_file(), "Capacitor 설정 없음"

    def test_manifest_json(self):
        assert (ROOT / "manifest.json").is_file(), "PWA manifest 없음"


# ═══════════════════════════════════════════════════════════════
# 9. Supabase Edge Functions 정적 smoke 검증 (Gen112)
# ═══════════════════════════════════════════════════════════════

class TestEdgeFunctionsStructure:
    """15 Supabase Edge Functions 정적 구조 smoke 검증.

    Deno 런타임 없이 수행하는 smoke test:
    - 각 function 디렉토리에 index.ts 존재
    - index.ts 가 Deno.serve 또는 std serve 를 사용
    - CORS 헤더 선언 존재
    - supabase-js import 존재 (auth/db 사용 function 에 한함)
    """

    EDGE_FUNCTIONS_DIR = ROOT / "supabase" / "functions"

    EXPECTED_FUNCTIONS = [
        "billing-apple-notifications",
        "billing-apple-verify",
        "billing-google-rtdn",
        "billing-google-verify",
        "create-checkout",
        "openai-proxy",
        "push-scheduler",
        "push-subscribe",
        "stripe-webhook",
        "toss-checkout",
        "toss-confirm",
        "toss-webhook",
        # 2026-06-03 dedup: toss-payment-{ready,confirm,webhook} (v2 dead code) 삭제.
        # 우월 로직은 v1 toss-{confirm,webhook} 으로 병합. tests/test_toss_routing.py 참조.
    ]

    def test_edge_functions_dir_exists(self):
        assert self.EDGE_FUNCTIONS_DIR.is_dir(), "supabase/functions/ 디렉토리 없음"

    def test_function_count_matches_expected(self):
        """12 function 디렉토리 전수 존재 검증 (toss v2 dedup 후: 15→12)"""
        actual = sorted(
            d.name for d in self.EDGE_FUNCTIONS_DIR.iterdir()
            if d.is_dir() and not d.name.startswith(("_", "."))
        )
        assert actual == sorted(self.EXPECTED_FUNCTIONS), (
            f"Edge Functions 목록 불일치.\nExpected: {sorted(self.EXPECTED_FUNCTIONS)}\nActual: {actual}"
        )

    @pytest.mark.parametrize("func_name", EXPECTED_FUNCTIONS)
    def test_index_ts_exists(self, func_name):
        index_file = self.EDGE_FUNCTIONS_DIR / func_name / "index.ts"
        assert index_file.is_file(), f"{func_name}/index.ts 없음"

    @pytest.mark.parametrize("func_name", EXPECTED_FUNCTIONS)
    def test_function_has_serve_handler(self, func_name):
        """각 function 은 serve(...) 핸들러를 export"""
        content = (self.EDGE_FUNCTIONS_DIR / func_name / "index.ts").read_text(encoding="utf-8")
        assert "serve(" in content, f"{func_name} serve(...) 핸들러 없음"

    # 클라이언트 브라우저가 직접 호출하는 function (CORS 필수)
    # webhook/notification/verify 는 서버-서버 호출이므로 CORS 불필요
    INTERACTIVE_FUNCTIONS = [
        "create-checkout",
        "openai-proxy",
        "push-scheduler",
        "push-subscribe",
        "toss-checkout",
        "toss-confirm",
    ]

    @pytest.mark.parametrize("func_name", INTERACTIVE_FUNCTIONS)
    def test_interactive_function_has_cors_headers(self, func_name):
        """브라우저 직접 호출 Edge Function 은 CORS 선언 필수"""
        content = (self.EDGE_FUNCTIONS_DIR / func_name / "index.ts").read_text(encoding="utf-8")
        has_cors = (
            "Access-Control-Allow-Origin" in content
            or "corsHeaders" in content
        )
        assert has_cors, f"{func_name} CORS 선언 누락 (브라우저 호출)"


class TestDistFreshness:
    """dist/ 빌드 산출물 stale 검증 (Gen112)"""

    DIST_DIR = ROOT / "dist"

    def test_dist_exists(self):
        assert self.DIST_DIR.is_dir(), "dist/ 디렉토리 없음 — vite build 미실행"

    def test_dist_has_index_html(self):
        """dist/index.html 진입점 존재"""
        assert (self.DIST_DIR / "index.html").is_file(), "dist/index.html 없음"

    def test_dist_newer_than_src_app_js(self):
        """dist/index.html mtime >= src/app.js mtime (빌드 최신성).

        stale 감지: src/ 수정 후 빌드 누락 시 FAIL.
        """
        import os
        src_app = SRC / "app.js"
        dist_idx = self.DIST_DIR / "index.html"
        if not src_app.is_file() or not dist_idx.is_file():
            pytest.skip("src/app.js 또는 dist/index.html 없음")
        src_mtime = os.path.getmtime(src_app)
        dist_mtime = os.path.getmtime(dist_idx)
        assert dist_mtime >= src_mtime, (
            f"dist/ 가 src/ 보다 오래됨 — rebuild 필요.\n"
            f"dist/index.html mtime: {dist_mtime}\nsrc/app.js mtime: {src_mtime}"
        )


# ═══════════════════════════════════════════════════════════════
# 전환 모먼트(잠금 화면) 고도화 — 변경 민감 회귀 방어 (2026-06-03)
# ═══════════════════════════════════════════════════════════════
class TestConversionLock:
    """프리미엄 잠금 = 전환 모먼트. 연구(freemium=욕구 제조) 기반 4요소를 핀.

    이 테스트가 존재하는 이유: 무료→유료 CTA 는 매출의 80%가 걸린 단일 지점인데
    과거엔 '융 심리학·전통 해몽서' 한 줄짜리 제네릭 서브텍스트뿐이었다.
    맥락 후킹 / 가치 스택(실제 산출물 4종) / 가격 앵커 / 신뢰선을 추가했고,
    다음 세션이 무심코 되돌리면 이 단언이 FAIL 하도록 결합한다.
    """

    DREAM_JS = (ROOT / "src" / "tabs" / "dream.js").read_text(encoding="utf-8")
    INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
    CSS = (ROOT / "src" / "styles" / "main.css").read_text(encoding="utf-8")

    def test_render_conversion_lock_exists(self):
        """전환 잠금 렌더 함수가 dream.js 에 존재 + showResult 가 호출."""
        assert "function renderConversionLock" in self.DREAM_JS, "renderConversionLock 함수 누락"
        assert "renderConversionLock(data,inp,credits)" in self.DREAM_JS, (
            "showResult 가 renderConversionLock 을 호출하지 않음 — 전환 잠금 미배선"
        )

    def test_contextual_hook_per_badge(self):
        """맥락 후킹: 배지별 분기(흉몽/길몽/재물운 등)로 욕구 제조."""
        for badge in ("흉몽", "길몽", "재물운", "연애운"):
            assert badge in self.DREAM_JS, f"_LOCK_HOOKS 배지 분기 누락: {badge}"
        assert "_LOCK_HOOKS" in self.DREAM_JS, "맥락 후킹 맵(_LOCK_HOOKS) 누락"

    def test_value_stack_four_deliverables(self):
        """가치 스택: 실제 산출물 4종(전통/심리/조언/깊은해석)이 명시."""
        for item in ("전통 해몽서", "융 심리학", "현실 조언", "깊은 해석 1,000자"):
            assert item in self.DREAM_JS, f"가치 스택 항목 누락: {item}"

    def test_price_anchor_present(self):
        """가격 앵커: 단건 ₩1,900 + 15회팩 회당 단가 정박."""
        assert "₩1,900" in self.DREAM_JS, "단건 가격 앵커 ₩1,900 누락"
        assert "1,327" in self.DREAM_JS, "15회팩 회당 단가 앵커 누락"

    def test_pack_unit_price_math_is_honest(self):
        """무결성: ₩1,327 주장이 실제 카탈로그(15팩 ₩19,900) 산수와 일치해야 함.

        no-fabrication: 앵커 수치가 임의 조작이 아님을 코드로 강제.
        """
        sub = (ROOT / "src" / "services" / "subscription.js").read_text(encoding="utf-8")
        assert "19900" in sub, "subscription.js 에 15팩 정가(19900) 부재 — 앵커 근거 소실"
        unit = round(19900 / 15)  # = 1327
        assert unit == 1327, f"15팩 회당 단가 산수 불일치: {unit}"
        assert "1,327" in self.DREAM_JS, "코드 앵커가 실제 산수(₩1,327)와 불일치"

    def test_lock_dom_slots_exist(self):
        """index.html 에 전환 잠금 DOM 슬롯이 존재(JS 가 채울 대상)."""
        for slot in ("lockHook", "lockValueStack", "lockPriceRow", "lockTrust"):
            assert f'id="{slot}"' in self.INDEX, f"잠금 DOM 슬롯 누락: {slot}"

    def test_lock_value_stack_css_exists(self):
        """가치 스택/가격/신뢰선 스타일이 main.css 에 정의."""
        for cls in (".lock-hook", ".lock-value-stack", ".lock-vitem", ".lock-price-now", ".lock-trust"):
            assert cls in self.CSS, f"전환 잠금 CSS 누락: {cls}"

    def test_credit_path_suppresses_price(self):
        """크레딧 보유 시 가격 행 숨김(결제 마찰 0 — 즉시 사용 유도)."""
        # credits>0 분기에서 priceEl.style.display='none'
        assert "priceEl.style.display='none'" in self.DREAM_JS, (
            "크레딧 보유 경로에서 가격 숨김 누락 — 마찰 0 경로 깨짐"
        )


class TestCliffhangerPreview:
    """잠금 미리보기 = 클리프행어(Zeigarnik) + 궁금증 갭(Tinder blur-to-reveal).

    벤치(WebSearch 2026-06): Blick "Cliffhanger Effect" — 임의 글자수 자르기(substring)
    대신 유용한 통찰 직전에서 끊으면 미완결감이 업그레이드를 유도. Tinder — "특정 답이
    존재한다"고 알리되 답은 잠금 → 결제. 이 단언이 존재하는 이유: 과거 lockPreview 는
    full.substring(0,250)+'...' 로 첫 섹션 중간을 아무 데서나 잘라(가치 입증 실패 + 클리프행어
    효과 0) 전환 동력이 약했다. 다음 세션이 무심코 substring 으로 되돌리면 FAIL 하게 결합한다.
    """

    DREAM_JS = (ROOT / "src" / "tabs" / "dream.js").read_text(encoding="utf-8")
    INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
    CSS = (ROOT / "src" / "styles" / "main.css").read_text(encoding="utf-8")

    def test_cliffhanger_builder_exists(self):
        """클리프행어 미리보기 빌더 함수 존재."""
        assert "function _buildCliffhangerPreview" in self.DREAM_JS, (
            "_buildCliffhangerPreview 빌더 누락 — 클리프행어 미리보기 미구현"
        )

    def test_arbitrary_substring_cut_removed(self):
        """회귀 방어: lockPreview 가 임의 글자수 자르기(substring(0,250))로 되돌아가면 FAIL.

        mutation-sensitive: 이 라인이 부활하면 클리프행어가 죽고 첫 섹션 중간이 잘린다.
        """
        assert "full.substring(0,250)" not in self.DREAM_JS, (
            "lockPreview 가 임의 substring(0,250) 자르기로 회귀 — 클리프행어 무력화"
        )

    def test_cliffhanger_wired_into_lock_preview(self):
        """showResultDetail 가 lockPreview 를 클리프행어 빌더로 채우는지 배선 확인."""
        assert "_buildCliffhangerPreview(full)" in self.DREAM_JS, (
            "showResultDetail 가 _buildCliffhangerPreview 를 호출하지 않음 — 미배선"
        )

    def test_curiosity_gap_teaser_exists(self):
        """궁금증 갭(잠긴 답의 제목만 노출) 렌더 함수 + 호출 배선."""
        assert "function _renderLockTeaser" in self.DREAM_JS, "_renderLockTeaser 누락"
        assert "_renderLockTeaser()" in self.DREAM_JS, (
            "renderConversionLock 가 _renderLockTeaser 를 호출하지 않음 — 궁금증 갭 미배선"
        )

    def test_locked_answer_labels_derived_from_real_sections(self):
        """무근거 조작 금지: 잠긴 답 라벨이 실제 해석 섹션 제목에서 도출됨."""
        # cliffhanger 가 window._lockedAnswerLabels 를 채우고 teaser 가 소비
        assert "_lockedAnswerLabels" in self.DREAM_JS, (
            "잠긴 답 라벨 파이프(_lockedAnswerLabels) 누락 — 실제 섹션 기반 도출 끊김"
        )
        assert "_LOCK_SECTION_LABELS" in self.DREAM_JS, (
            "섹션→라벨 매핑(_LOCK_SECTION_LABELS) 누락"
        )

    def test_teaser_dom_slot_and_css_exist(self):
        """index.html 에 lockTeaser 슬롯 + main.css 에 칩 스타일 존재."""
        assert 'id="lockTeaser"' in self.INDEX, "잠금 티저 DOM 슬롯(lockTeaser) 누락"
        for cls in (".lock-teaser", ".lock-teaser-chip"):
            assert cls in self.CSS, f"잠금 티저 CSS 누락: {cls}"
