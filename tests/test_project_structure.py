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

ROOT = pathlib.Path(r"C:\JARVIS_NEW\projects\MONGGEUL")
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
