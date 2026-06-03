"""
MONGGEUL Harness Tests — 몽글몽글 프로젝트 구조/규칙 검증

Fast file-based checks only. No network, no build, no Node.js required.
"""

import json
import os
import re
import pathlib

import pytest

# [2026-06-03] 독립 repo self-contained 화 — 하드코딩 외부경로(스테일 구버전) 정정.
#   이 파일은 tests/harness/ 하위 → repo root = parent.parent.parent.
ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "src"


# ── 1. 기능 추가 금지 규칙 ─────────────────────────────────────────
class TestNoNewFeaturesWithoutInstruction:
    """CLAUDE.md must contain the absolute rule forbidding new features."""

    def test_claude_md_exists(self):
        assert (ROOT / "CLAUDE.md").exists()

    def test_no_new_features_rule(self):
        text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        # 핵심 원칙 1번: "기능 추가 금지" 또는 영문 equivalent
        assert "기능 추가 금지" in text or "지시하지 않은 새 기능은 절대 추가하지 않는다" in text, (
            "CLAUDE.md must contain the '기능 추가 금지' rule"
        )


# ── 2. 3대 축만 허용 ──────────────────────────────────────────────
class TestCoreAxesOnly:
    """Product axes must be limited to 해몽 / 달이 / 기록 (MY)."""

    def test_three_axes_stated_in_claude_md(self):
        text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        for axis in ("해몽", "달이", "기록"):
            assert axis in text, f"CLAUDE.md must mention core axis '{axis}'"

    def test_dream_tab_exists(self):
        assert (SRC / "tabs" / "dream.js").exists(), "Dream (해몽) tab missing"

    def test_dali_tab_exists(self):
        assert (SRC / "tabs" / "dali.js").exists(), "Dali (달이) tab missing"

    def test_my_tab_exists(self):
        assert (SRC / "tabs" / "my.js").exists(), "MY (기록) tab missing"


# ── 3. Supabase Auth 설정 ──────────────────────────────────────────
class TestSupabaseAuth:
    """Supabase auth configuration must be present."""

    def test_auth_service_exists(self):
        assert (SRC / "services" / "auth.js").exists(), "auth.js service missing"

    def test_auth_imports_supabase(self):
        text = (SRC / "services" / "auth.js").read_text(encoding="utf-8")
        assert "@supabase/supabase-js" in text, "auth.js must import supabase client"

    def test_supabase_config_toml(self):
        assert (ROOT / "supabase" / "config.toml").exists(), "supabase/config.toml missing"


# ── 4. PWA manifest.json ──────────────────────────────────────────
class TestPwaManifest:
    """PWA manifest must exist with required fields."""

    @pytest.fixture()
    def manifest(self):
        path = ROOT / "manifest.json"
        assert path.exists(), "manifest.json not found at project root"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_name(self, manifest):
        assert "name" in manifest and manifest["name"]

    def test_short_name(self, manifest):
        assert "short_name" in manifest and manifest["short_name"]

    def test_start_url(self, manifest):
        assert "start_url" in manifest

    def test_display(self, manifest):
        assert manifest.get("display") in ("standalone", "fullscreen", "minimal-ui")

    def test_icons(self, manifest):
        icons = manifest.get("icons", [])
        assert len(icons) >= 1, "At least one icon required"
        for icon in icons:
            assert "src" in icon and "sizes" in icon


# ── 5. Service Worker ──────────────────────────────────────────────
class TestServiceWorker:
    """A service worker file must exist for offline PWA support."""

    def test_sw_in_public(self):
        assert (ROOT / "public" / "sw.js").exists(), "public/sw.js missing"

    def test_sw_not_empty(self):
        content = (ROOT / "public" / "sw.js").read_text(encoding="utf-8")
        assert len(content.strip()) > 50, "sw.js appears to be a stub"


# ── 6. Vite 설정 ──────────────────────────────────────────────────
class TestViteConfig:
    """vite.config.js must exist."""

    def test_vite_config_exists(self):
        assert (ROOT / "vite.config.js").exists(), "vite.config.js missing"

    def test_vite_config_not_empty(self):
        text = (ROOT / "vite.config.js").read_text(encoding="utf-8")
        assert "defineConfig" in text or "export default" in text, (
            "vite.config.js must contain a valid config export"
        )


# ── 7. RPG 잔재 없음 ──────────────────────────────────────────────
class TestNoRpgRemnants:
    """Source must not contain RPG-era function/class names."""

    RPG_PATTERNS = [
        r"\bspawnCat\b",
        r"\blevelUp\b",
        r"\bcatRoom\b",
        r"\bbuildingUpgrade\b",
        r"\bcatCollection\b",
        r"\bupgradeFacility\b",
        r"\.rpg-",
        r"\.cat-room",
        r"\.facility-",
        r"\.building-",
    ]

    def _scan_src(self, pattern: str) -> list[str]:
        """Return list of (file, line) hits for a regex pattern in src/."""
        hits = []
        for p in SRC.rglob("*"):
            if p.suffix not in (".js", ".css", ".html"):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if re.search(pattern, line):
                    hits.append(f"{p.relative_to(ROOT)}:{i}")
        return hits

    @pytest.mark.parametrize("pattern", RPG_PATTERNS)
    def test_no_rpg_pattern(self, pattern):
        hits = self._scan_src(pattern)
        assert not hits, f"RPG remnant '{pattern}' found in: {hits[:5]}"


# ── 8. 꿈 해몽 서비스 ────────────────────────────────────────────
class TestDreamInterpretation:
    """Dream interpretation related service/module must exist."""

    def test_dream_context_service(self):
        assert (SRC / "services" / "dream-context.js").exists(), (
            "dream-context.js service missing"
        )

    def test_dream_tab(self):
        assert (SRC / "tabs" / "dream.js").exists(), "dream tab missing"

    def test_api_service(self):
        assert (SRC / "services" / "api.js").exists(), "api.js service missing"


# ── 9. 감정 분석 모듈 ────────────────────────────────────────────
class TestEmotionAnalysis:
    """Emotion analysis module must exist."""

    def test_emotion_util(self):
        assert (SRC / "utils" / "emotion.js").exists(), "utils/emotion.js missing"

    def test_emotion_chart_component(self):
        assert (SRC / "components" / "emotion-chart.js").exists(), (
            "components/emotion-chart.js missing"
        )


# ── 10. 상징 사전 데이터 ──────────────────────────────────────────
class TestSymbolDictionary:
    """Symbol dictionary data/module must exist."""

    def test_symbols_util(self):
        assert (SRC / "utils" / "symbols.js").exists(), "utils/symbols.js missing"

    def test_symbol_tracker_component(self):
        assert (SRC / "components" / "symbol-tracker.js").exists(), (
            "components/symbol-tracker.js missing"
        )

    def test_symbols_not_empty(self):
        text = (SRC / "utils" / "symbols.js").read_text(encoding="utf-8")
        assert len(text.strip()) > 100, "symbols.js appears to be a stub"
