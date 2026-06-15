"""
MONGGEUL Business Logic Tests — 비즈니스 로직 단위 테스트
해몽/달이/감정/결제/구독/패턴 엔진 검증

Python에서 JS 소스를 파싱하여 데이터 구조, 규칙 일관성, 로직 패턴을 검증한다.
네트워크/빌드 불필요. 순수 파일 기반 테스트.
"""

import json
import os
import re
import pathlib
from datetime import datetime

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
SERVICES = SRC / "services"
UTILS = SRC / "utils"
TABS = SRC / "tabs"


# ═══════════════════════════════════════════════════════════════
# 1. 해몽 로직 (Dream Interpretation)
# ═══════════════════════════════════════════════════════════════

class TestDreamInterpretationLogic:
    """해몽 비즈니스 로직 검증"""

    @pytest.fixture(autouse=True)
    def load_dream_source(self):
        self.dream_src = (TABS / "dream.js").read_text(encoding="utf-8")
        self.sanitize_src = (UTILS / "sanitize.js").read_text(encoding="utf-8")

    def test_dream_result_validation_has_all_required_fields(self):
        """validateDreamResult must validate title, badges, stats, emotions, preview, traditional, psychology, advice"""
        required_fields = ["title", "badges", "stats", "emotions", "preview", "traditional", "psychology", "advice"]
        for field in required_fields:
            assert f"data.{field}" in self.sanitize_src or f"'{field}'" in self.sanitize_src, (
                f"validateDreamResult missing field: {field}"
            )

    def test_stats_radar_has_six_axes(self):
        """레이더 차트 6축: 길흉, 연애운, 재물운, 건강운, 활력, 직관"""
        axes = ["길흉", "연애운", "재물운", "건강운", "활력", "직관"]
        for axis in axes:
            assert axis in self.sanitize_src, f"Stats axis '{axis}' missing from validateStats"

    def test_stats_clamps_values_0_to_100(self):
        """Stats values must be clamped between 0 and 100"""
        assert "Math.max(0" in self.sanitize_src and "Math.min(100" in self.sanitize_src, (
            "Stats validation must clamp to 0-100 range"
        )

    def test_title_max_length_50(self):
        """Title must be truncated to max 50 chars"""
        assert "substring(0,50)" in self.sanitize_src, "Title must be limited to 50 characters"

    def test_badges_max_5(self):
        """Badges must be limited to max 5"""
        assert "slice(0,5)" in self.sanitize_src, "Badges must be limited to 5 items"

    def test_dream_draft_autosave_exists(self):
        """Dream draft auto-save must be implemented"""
        assert "saveDreamDraft" in self.dream_src, "Draft auto-save function missing"
        assert "mg_dream_draft" in self.dream_src, "Draft localStorage key missing"

    def test_dream_placeholders_at_least_3(self):
        """Dream input placeholders must have at least 3 variations"""
        matches = re.findall(r"DREAM_PLACEHOLDERS\s*=\s*\[([^\]]+)\]", self.dream_src, re.DOTALL)
        assert matches, "DREAM_PLACEHOLDERS array not found"
        items = [s.strip() for s in matches[0].split("'") if s.strip() and s.strip() != ","]
        assert len(items) >= 3, f"Need at least 3 placeholders, found {len(items)}"


# ═══════════════════════════════════════════════════════════════
# 2. 달이 캐릭터 응답 (Dali Character)
# ═══════════════════════════════════════════════════════════════

class TestDaliCharacterLogic:
    """달이 AI 동반자 로직 검증"""

    @pytest.fixture(autouse=True)
    def load_dali_source(self):
        self.dali_src = (TABS / "dali.js").read_text(encoding="utf-8")
        self.premium_src = (UTILS / "dali-premium-prompts.js").read_text(encoding="utf-8")

    def test_time_context_covers_all_periods(self):
        """getTimeContext must cover morning, daytime, evening, night"""
        for period in ["morning", "daytime", "evening", "night"]:
            assert f"'{period}'" in self.dali_src, f"Time period '{period}' missing from getTimeContext"

    def test_time_context_has_greeting_and_prompt(self):
        """Each time context must have greeting and prompt"""
        assert self.dali_src.count("greeting:") >= 4, "Need greeting for all 4 time periods"
        assert self.dali_src.count("prompt:") >= 4, "Need prompt for all 4 time periods"

    def test_emotion_trend_detects_three_states(self):
        """getEmotionTrend must return improving, worsening, stable"""
        for state in ["improving", "worsening", "stable"]:
            assert f"'{state}'" in self.dali_src, f"Emotion trend state '{state}' missing"

    def test_negative_emotions_defined(self):
        """Negative emotions list must include standard negative emotions"""
        neg_emotions = ["불안", "공포", "슬픔", "분노", "혼란"]
        neg_match = re.search(r"neg\s*=\s*\[([^\]]+)\]", self.dali_src)
        assert neg_match, "Negative emotions array not found"
        for emo in neg_emotions:
            assert emo in neg_match.group(1), f"Negative emotion '{emo}' missing"

    def test_streak_symbol_needs_at_least_2_dreams(self):
        """findStreakSymbol must require at least 2 recent dreams"""
        assert "recent.length<2" in self.dali_src or "recent.length < 2" in self.dali_src, (
            "findStreakSymbol must check minimum dream count"
        )

    def test_premium_suggestion_categories_complete(self):
        """Premium suggestion must cover all emotional categories"""
        required = ["anxiety", "recurring", "growth", "sadness", "rich_data", "deep_conversation"]
        for cat in required:
            assert f"'{cat}'" in self.premium_src or f'"{cat}"' in self.premium_src or f"{cat}:" in self.premium_src, (
                f"Premium suggestion category '{cat}' missing"
            )

    def test_premium_suggestions_are_exploratory_tone(self):
        """All premium suggestions must use exploratory tone (no fear marketing)"""
        # Check that suggestions use soft phrasing
        fear_patterns = ["지금 안 하면", "놓치", "후회", "위험"]
        for pattern in fear_patterns:
            assert pattern not in self.premium_src, (
                f"Fear marketing detected: '{pattern}' found in premium suggestions"
            )

    def test_detect_suggestion_context_word_lists(self):
        """Suggestion detection must have word lists for all categories"""
        for word_list in ["ANXIETY_WORDS", "SADNESS_WORDS", "GROWTH_WORDS", "RECURRING_WORDS"]:
            assert word_list in self.premium_src, f"Word list '{word_list}' missing"


# ═══════════════════════════════════════════════════════════════
# 3. 감정 태그/분류 (Emotion Tagging)
# ═══════════════════════════════════════════════════════════════

class TestEmotionTagging:
    """감정 자동 감지 규칙 검증"""

    @pytest.fixture(autouse=True)
    def load_emotion_source(self):
        self.emotion_src = (UTILS / "emotion.js").read_text(encoding="utf-8")

    def test_emotion_rules_array_exists(self):
        """EMOTION_RULES array must be exported"""
        assert "export const EMOTION_RULES" in self.emotion_src

    def test_at_least_40_emotion_rules(self):
        """Must have at least 40 emotion detection rules for comprehensive coverage"""
        rule_count = self.emotion_src.count("keywords:")
        assert rule_count >= 40, f"Need at least 40 rules, found {rule_count}"

    def test_covers_major_emotion_categories(self):
        """Must cover all major dream emotion categories"""
        categories = [
            "공포", "불안", "슬픔", "그리움",
            "분노", "기쁨", "사랑", "동물",
            "자연", "장소", "이동"
        ]
        for cat in categories:
            assert cat in self.emotion_src, f"Emotion category '{cat}' not covered"

    def test_each_rule_has_keywords_and_emotions(self):
        """Each rule must have both keywords and emotions arrays"""
        keywords_count = self.emotion_src.count("keywords:")
        emotions_count = self.emotion_src.count("emotions:")
        assert keywords_count == emotions_count, (
            f"Mismatch: {keywords_count} keywords entries vs {emotions_count} emotions entries"
        )

    def test_emoji_prefix_in_emotions(self):
        """Emotion values should have emoji prefixes for UI display"""
        # Find emotion entries like ['😱 무서움', '😰 초조함']
        emotion_matches = re.findall(r"emotions:\s*\[([^\]]+)\]", self.emotion_src)
        assert emotion_matches, "No emotion arrays found"
        # Check at least 80% have emoji prefix
        emoji_count = 0
        total_count = 0
        for match in emotion_matches:
            items = re.findall(r"'([^']+)'", match)
            for item in items:
                total_count += 1
                if re.match(r"[^\w\s]", item):  # starts with non-word char (emoji)
                    emoji_count += 1
        ratio = emoji_count / total_count if total_count > 0 else 0
        assert ratio > 0.7, f"Only {ratio:.0%} of emotions have emoji prefix, need >70%"

    def test_snake_keywords_present(self):
        """Snake (뱀) dreams are very common - must be covered"""
        assert "뱀" in self.emotion_src, "뱀 (snake) keywords missing"

    def test_falling_keywords_present(self):
        """Falling dreams are very common - must be covered"""
        assert "추락" in self.emotion_src or "떨어지" in self.emotion_src, (
            "Falling dream keywords missing"
        )

    def test_teeth_keywords_present(self):
        """Teeth falling out dreams are very common - must be covered"""
        assert "이빨" in self.emotion_src or "치아" in self.emotion_src, (
            "Teeth dream keywords missing"
        )


# ═══════════════════════════════════════════════════════════════
# 4. 결제 플로우 (Payment)
# ═══════════════════════════════════════════════════════════════

class TestPaymentFlow:
    """결제 시스템 비즈니스 로직 검증"""

    @pytest.fixture(autouse=True)
    def load_payment_source(self):
        self.payment_src = (SERVICES / "payment.js").read_text(encoding="utf-8")

    def test_product_catalog_has_all_products(self):
        """PRODUCT_CATALOG must have all 5 products from BM spec"""
        required = ["pack_1", "pack_5", "pack_15", "unconscious_profile", "pro_monthly"]
        for prod in required:
            assert prod in self.payment_src, f"Product '{prod}' missing from catalog"

    def test_product_prices_match_spec(self):
        """Product prices must match CLAUDE.md spec.
        pro_monthly 는 plus_monthly 의 alias(동일 'plus' entitlement)이므로 가격도 3900 으로 통일됨
        (2026-06-14 보안/매출 수술: 동일 Plus 구독을 경로에 따라 9900/3900 으로 청구하던 버그 정정)."""
        price_map = {
            "1900": "상세 해몽 1회",
            "7900": "상세 해몽 5회",
            "19900": "상세 해몽 15회/Premium 월간",
            "2900": "무의식 프로파일",
            "3900": "Plus 월간 구독(pro_monthly alias 포함)",
        }
        for price in price_map:
            assert price in self.payment_src, f"Price {price}원 missing for {price_map[price]}"
        # 회귀 가드: pro_monthly 가 다시 9900(스테일 정가)으로 되돌아가지 않도록
        assert "price: 9900" not in self.payment_src, (
            "pro_monthly 가 9900 으로 회귀 — plus_monthly alias 와 가격 불일치(이중청구 버그) 재발"
        )

    def test_payment_method_pg_mapping(self):
        """Payment methods must map to correct PG"""
        assert "card:" in self.payment_src and "stripe" in self.payment_src
        assert "kakaopay:" in self.payment_src and "toss" in self.payment_src
        assert "naverpay:" in self.payment_src

    def test_order_id_generation(self):
        """Order ID must be generated with MG_ prefix"""
        assert "MG_" in self.payment_src, "Order ID must use MG_ prefix"
        assert "generateOrderId" in self.payment_src

    def test_login_required_before_payment(self):
        """startPayment() must gate on login BEFORE generating an order / starting checkout.

        강화(2026-06-16): 이전엔 'store.currentUser' 문자열이 어디든 1번 있으면 통과(vacuous).
        이제 startPayment 본문에서 (1) currentUser 부재 시 early-return 가드가 (2) generateOrderId/
        checkout_started 보다 '앞에' 있어야 함을 위치로 검증. 가드를 지우거나 뒤로 옮기면 FAIL.
        (런타임 행위 검증은 test_business_logic_runtime.py)."""
        m = re.search(
            r"export async function startPayment\([^)]*\)\s*\{([\s\S]*?)\n\}",
            self.payment_src,
        )
        assert m, "startPayment 함수를 찾을 수 없습니다"
        body = m.group(1)
        # 로그인 미충족 시 early-return 가드
        guard = re.search(r"if\s*\(\s*!store\.supabase\s*\|\|\s*!store\.currentUser\s*\)\s*\{[^}]*return", body)
        assert guard, "startPayment 에 (!store.supabase || !store.currentUser) early-return 로그인 가드 없음"
        guard_idx = guard.start()
        order_idx = body.find("generateOrderId")
        checkout_idx = body.find("checkout_started")
        assert order_idx != -1, "generateOrderId 호출 없음"
        assert guard_idx < order_idx, "로그인 가드가 주문번호 생성보다 뒤 — 비로그인도 주문 생성됨"
        assert checkout_idx == -1 or guard_idx < checkout_idx, (
            "로그인 가드가 checkout_started 보다 뒤 — 비로그인도 결제 시작 로깅됨"
        )

    def test_checkout_events_logged(self):
        """All checkout events must be logged"""
        events = ["checkout_started", "checkout_completed", "checkout_error", "checkout_abandoned"]
        for event in events:
            assert event in self.payment_src, f"Checkout event '{event}' not logged"

    def test_stripe_and_toss_both_supported(self):
        """Both Stripe and Toss PGs must be supported"""
        assert "startStripeCheckout" in self.payment_src, "Stripe checkout missing"
        assert "startTossCheckout" in self.payment_src, "Toss checkout missing"

    def test_payment_return_handlers_exist(self):
        """handlePaymentReturn() must route Stripe(checkout=success/cancel) AND Toss(paymentKey) returns.

        강화(2026-06-16): 이전엔 'handleTossReturn' OR 'paymentKey' (둘 중 하나만 있어도 통과)로
        toss 리턴 배선 누락을 못 잡았다. 이제 handlePaymentReturn 본문에서 stripe(success/cancel)
        분기와 toss(paymentKey→handleTossReturn) 라우팅을 모두 확인 + handleTossReturn 정의 확인."""
        m = re.search(
            r"export function handlePaymentReturn\(\)\s*\{([\s\S]*?)\n\}",
            self.payment_src,
        )
        assert m, "handlePaymentReturn 함수를 찾을 수 없습니다"
        body = m.group(1)
        # Stripe 리턴 분기
        assert "checkout" in body and "success" in body, "Stripe success 리턴 분기 없음"
        assert "cancel" in body, "Stripe cancel 리턴 분기 없음"
        # Toss 리턴 라우팅: paymentKey 감지 → handleTossReturn 위임
        assert "paymentKey" in body, "Toss paymentKey 리턴 감지 없음"
        assert "handleTossReturn(" in body, "paymentKey 감지 후 handleTossReturn 위임 없음"
        # handleTossReturn 실제 정의(승인 처리)
        assert re.search(r"function handleTossReturn\s*\(", self.payment_src), (
            "handleTossReturn 함수 정의 없음(토스 승인 처리 부재)"
        )

    def test_entitlement_check_with_fallback(self):
        """checkEntitlement() must invoke fallbackEntitlementCheck() in its catch block.

        강화(2026-06-16): 이전엔 'fallback' 문자열이 (대소문자무시) 어디든 있으면 통과(always-true:
        주석 한 줄로도 PASS). 이제 checkEntitlement 본문 try/catch 구조 + catch 안에서 실제
        fallbackEntitlementCheck() '호출' 을 검증. 폴백 호출을 제거하면 FAIL."""
        m = re.search(
            r"export async function checkEntitlement\(\)\s*\{([\s\S]*?)\n\}",
            self.payment_src,
        )
        assert m, "checkEntitlement 함수를 찾을 수 없습니다"
        body = m.group(1)
        assert "try" in body and "catch" in body, "checkEntitlement 에 try/catch 없음(폴백 경로 부재)"
        # catch 블록 추출 후 그 안에서 fallbackEntitlementCheck() 호출 확인
        cm = re.search(r"catch\s*\([^)]*\)\s*\{([\s\S]*)\}", body)
        assert cm, "catch 블록을 찾을 수 없습니다"
        assert "fallbackEntitlementCheck()" in cm.group(1), (
            "catch 블록에서 fallbackEntitlementCheck() 를 호출하지 않음 — DB 미배포 시 폴백 미작동"
        )
        # 폴백 함수 자체가 정의되어 있어야 함
        assert re.search(r"function fallbackEntitlementCheck\s*\(", self.payment_src), (
            "fallbackEntitlementCheck 함수 정의 없음"
        )


# ═══════════════════════════════════════════════════════════════
# 5. 구독/크레딧 시스템 (Subscription)
# ═══════════════════════════════════════════════════════════════

class TestSubscriptionSystem:
    """구독 및 크레딧 관리 로직 검증"""

    @pytest.fixture(autouse=True)
    def load_subscription_source(self):
        self.sub_src = (SERVICES / "subscription.js").read_text(encoding="utf-8")

    def test_products_defined_with_prices(self):
        """PRODUCTS must define all product tiers with prices"""
        assert "PRODUCTS" in self.sub_src
        assert "1900" in self.sub_src and "7900" in self.sub_src
        assert "19900" in self.sub_src and "2900" in self.sub_src

    def test_free_daily_limit_is_2(self):
        """Free tier daily dream limit must be 2"""
        assert "DAILY_FREE_LIMIT = 2" in self.sub_src or "DAILY_FREE_LIMIT=2" in self.sub_src, (
            "Free daily limit must be set to 2"
        )

    def test_guest_gets_1_dream(self):
        """canUseDream() 게스트 경로: 백엔드 정상 시 1회, 데모(백엔드 다운) 시 GUEST_DEMO_LIMIT.

        강화(2026-06-16): 이전엔 'mg_guest_dream_used' 와 'remaining:' 문자열 존재만 확인(vacuous).
        이제 canUseDream 게스트 분기 구조를 검증: (정상) guest_used 없으면 remaining 1,
        (데모) !store.supabase 시 GUEST_DEMO_LIMIT 적용. 행위는 런타임 파일에서 1/3 검증."""
        m = re.search(
            r"export async function canUseDream\(\)\s*\{([\s\S]*?)\n\}",
            self.sub_src,
        )
        assert m, "canUseDream 함수를 찾을 수 없습니다"
        body = m.group(1)
        # 비로그인 게스트 분기
        assert "!store.currentUser" in body, "게스트(비로그인) 분기 없음"
        assert "mg_guest_dream_used" in body, "정상 구간 게스트 소진 플래그 없음"
        # 정상 구간: remaining 1 (guestUsed 없을 때)
        assert re.search(r"remaining:\s*guestUsed\s*\?\s*0\s*:\s*1", body), (
            "정상 구간 게스트 remaining 이 (소진? 0 : 1) 구조가 아님 — 1회 체험 보장 깨짐"
        )

    def test_pro_gets_unlimited(self):
        """canUseDream() 구독자(plus/premium/pro) 경로가 remaining: Infinity 를 반환해야 한다.

        강화(2026-06-16): 이전엔 'Infinity' 문자열이 파일 어디든 있으면 통과(vacuous).
        이제 canUseDream 본문에서 구독 tier 분기가 Infinity 를 반환하는 구조를 검증."""
        m = re.search(
            r"export async function canUseDream\(\)\s*\{([\s\S]*?)\n\}",
            self.sub_src,
        )
        assert m, "canUseDream 함수를 찾을 수 없습니다"
        body = m.group(1)
        # getUserTier() 결과 기반 구독 분기 — dev_unlock/BETA 조기반환이 아니라 '실제 구독' 경로
        tier_branch = re.search(
            r"const tier = await getUserTier\(\);\s*if\s*\([^)]*tier === 'plus'[^)]*\)\s*\{([^}]*)\}",
            body,
        )
        assert tier_branch, "getUserTier() 기반 구독(plus/premium/pro) 분기를 찾을 수 없음"
        assert "remaining: Infinity" in tier_branch.group(1), (
            "실제 구독자(getUserTier=plus/premium) 분기가 remaining: Infinity 를 반환하지 않음 — "
            "구독 무제한 보장 깨짐(0 등 유한값으로 회귀)"
        )

    def test_credit_use_decrements(self):
        """useCredit() must (1) reject when credits<=0 and (2) decrement on the local/guest path.

        강화(2026-06-16): 이전엔 'credits - 1' OR 'credits-1' OR 'newCredits' (셋 중 하나만 있어도
        통과)라 차감 로직이 망가져도 'newCredits' 단어만 남으면 PASS(vacuous). 이제 useCredit 본문에서
        잔액 가드(credits<=0 → false)와 로컬 차감(credits-1 → setItem) 구조를 검증.
        (실제 차감 행위는 test_business_logic_runtime.py 런타임으로 검증.)"""
        m = re.search(
            r"export async function useCredit\(\)\s*\{([\s\S]*?)\n\}",
            self.sub_src,
        )
        assert m, "useCredit 함수를 찾을 수 없습니다"
        body = m.group(1)
        # 잔액 0 이하면 차감 거부
        assert re.search(r"credits\s*<=\s*0", body), "useCredit 에 잔액 가드(credits<=0)가 없음 — 음수 차감 위험"
        assert "return false" in body, "잔액 부족 시 false 반환 경로 없음"
        # 로컬/게스트 경로 차감 + localStorage 반영
        assert re.search(r"credits\s*-\s*1", body), "로컬 경로 차감(credits - 1) 없음"
        assert "mg_premium_credits" in body and "setItem" in body, "차감 후 localStorage 반영 없음"

    def test_credit_add_increments(self):
        """addCredits must increment credit count via server-authority atomic RPC.

        2026-06-16: prior version pinned the literal 'current + count' (client-side sum
        then upsert-overwrite) — that exact pattern was a lost-update race AND was RLS-rejected
        after own_ent drop. The fix routes server writes through the atomic add_credits() RPC
        (server-side `premium_credits + p_count`). Pin the RPC call, not the removed racy sum."""
        assert "addCredits" in self.sub_src
        assert "rpc('add_credits'" in self.sub_src, (
            "addCredits must call the atomic server RPC add_credits (race-safe increment), "
            "not a client-side sum+upsert"
        )

    def test_sku_maps_for_ios_and_android(self):
        """SKU maps must exist for both iOS and Android"""
        assert "SKU_MAP" in self.sub_src
        assert "ios" in self.sub_src and "android" in self.sub_src

    def test_premium_suggest_cooldown_24h(self):
        """Premium suggestion cooldown must be 24 hours"""
        assert "24 * 60 * 60 * 1000" in self.sub_src or "86400000" in self.sub_src, (
            "Premium suggestion cooldown must be 24 hours"
        )

    def test_cached_tier_returns_pro_or_free(self):
        """getCachedTier() must default to 'free' when no subscription, and honor dev/beta unlock.

        강화(2026-06-16): 이전엔 'pro'/'free' 문자열이 파일 어디든 있으면 통과(vacuous).
        이제 getCachedTier 본문에서 (1) 구독 없으면 'free' 반환, (2) dev_unlock/BETA 분기를
        검증. 기본값을 'free' 가 아닌 것으로 바꾸면(페이월 우회) FAIL."""
        m = re.search(
            r"export function getCachedTier\(\)\s*\{([\s\S]*?)\n\}",
            self.sub_src,
        )
        assert m, "getCachedTier 함수를 찾을 수 없습니다"
        body = m.group(1)
        # 구독 없으면 free
        assert re.search(r"if\s*\(\s*!_cachedSubscription\s*\)\s*return\s*'free'", body), (
            "구독 없을 때 'free' 기본값 반환이 없음 — 미구독자가 유료 tier 로 새는 위험"
        )
        # dev/beta unlock 분기
        assert "BETA_OPEN_ALL" in body, "BETA_OPEN_ALL 분기 없음"
        assert "mg_dev_unlock" in body, "dev unlock 분기 없음"


# ═══════════════════════════════════════════════════════════════
# 6. 꿈 패턴 엔진 (Dream Pattern Engine)
# ═══════════════════════════════════════════════════════════════

class TestDreamPatternEngine:
    """꿈 패턴 분석 엔진 (마르코프 + 예측) 검증"""

    @pytest.fixture(autouse=True)
    def load_pattern_source(self):
        self.pattern_src = (SERVICES / "dream-pattern.js").read_text(encoding="utf-8")

    def test_markov_states_defined(self):
        """Markov states must include all 5 emotion states"""
        states = ["평온", "불안", "공포", "기쁨", "슬픔"]
        for state in states:
            assert f"'{state}'" in self.pattern_src, f"Markov state '{state}' missing"

    def test_classify_emotion_covers_all_states(self):
        """classifyEmotion must be able to classify into all 5 states"""
        assert "classifyEmotion" in self.pattern_src
        # Default return should be '평온'
        assert "return '평온'" in self.pattern_src or "return'평온'" in self.pattern_src

    def test_transition_matrix_is_normalized(self):
        """Transition matrix must normalize to percentages"""
        assert "Math.round" in self.pattern_src
        assert "* 100" in self.pattern_src

    def test_prediction_requires_minimum_3_logs(self):
        """predictNextState must require at least 3 dream logs"""
        assert "logs.length < 3" in self.pattern_src or "logs.length<3" in self.pattern_src

    def test_recurring_clusters_require_3_occurrences(self):
        """Recurring dream detection requires at least 3 occurrences"""
        assert "entries.length >= 3" in self.pattern_src or "entries.length>=3" in self.pattern_src

    def test_clusters_limited_to_5(self):
        """Cluster results must be limited to top 5"""
        assert "slice(0, 5)" in self.pattern_src or "slice(0,5)" in self.pattern_src

    def test_forecast_frequency_requires_5_logs(self):
        """Frequency forecast requires at least 5 logs"""
        assert "logs.length < 5" in self.pattern_src or "logs.length<5" in self.pattern_src

    def test_trend_types_defined(self):
        """Frequency trends must classify as increasing, decreasing, stable"""
        for trend in ["increasing", "decreasing", "stable"]:
            assert f"'{trend}'" in self.pattern_src

    def test_pattern_report_exported(self):
        """generatePatternReport must be exported"""
        assert "export function generatePatternReport" in self.pattern_src


# ═══════════════════════════════════════════════════════════════
# 7. 꿈 맥락 CRM (Dream Context)
# ═══════════════════════════════════════════════════════════════

class TestDreamContextCRM:
    """개인 맞춤 해몽 맥락 관리 검증"""

    @pytest.fixture(autouse=True)
    def load_context_source(self):
        self.ctx_src = (SERVICES / "dream-context.js").read_text(encoding="utf-8")

    def test_context_stored_in_localstorage(self):
        """User context must be stored in localStorage"""
        assert "mg_dream_context" in self.ctx_src

    def test_follow_up_questions_emotion_based(self):
        """Follow-up questions must trigger on negative emotions"""
        neg_keywords = ["무서", "불안", "슬프", "공포"]
        for kw in neg_keywords:
            assert kw in self.ctx_src, f"Negative emotion keyword '{kw}' not checked"

    def test_follow_up_limited_to_2(self):
        """Follow-up questions must be limited to max 2"""
        assert "slice(0, 2)" in self.ctx_src or "slice(0,2)" in self.ctx_src

    def test_life_stage_prompts_cover_all_stages(self):
        """Life stage prompts must cover all defined stages"""
        stages = ["학생", "취준생", "직장인", "이직 고민", "연애/결혼", "육아", "은퇴/쉬는 중"]
        for stage in stages:
            assert f"'{stage}'" in self.ctx_src, f"Life stage '{stage}' prompt missing"

    def test_context_prompt_injection_fields(self):
        """Context prompt must include all user fields"""
        fields = ["lifeStage", "currentStress", "relationshipStatus",
                  "financialConcern", "relatedMemory", "dreamFeeling", "dreamFrequency"]
        for field in fields:
            assert field in self.ctx_src, f"Context field '{field}' missing from prompt injection"

    def test_badge_based_follow_up(self):
        """Follow-up questions must trigger on dream badges (흉몽, 재물운, 연애운)"""
        for badge in ["흉몽", "재물운", "연애운"]:
            assert badge in self.ctx_src, f"Badge '{badge}' not used for follow-up"


# ═══════════════════════════════════════════════════════════════
# 8. 보안 유틸리티 (Sanitize)
# ═══════════════════════════════════════════════════════════════

class TestSanitizeUtils:
    """XSS 방지 및 입력 검증"""

    @pytest.fixture(autouse=True)
    def load_sanitize_source(self):
        self.san_src = (UTILS / "sanitize.js").read_text(encoding="utf-8")

    def test_esc_handles_all_xss_chars(self):
        """esc() must escape &, <, >, \", '"""
        xss_chars = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]
        for char in xss_chars:
            assert char in self.san_src, f"XSS escape '{char}' missing from esc()"

    def test_sanitize_allows_only_safe_tags(self):
        """sanitize() must only allow <strong> and <br> tags"""
        assert "<strong>" in self.san_src
        assert "<br>" in self.san_src
        # Should not allow script, img, etc
        assert "<script>" not in self.san_src
        assert "<img" not in self.san_src

    def test_url_validation_https_only(self):
        """isValidUrl must only accept https: URLs"""
        assert "https:" in self.san_src
        assert "isValidUrl" in self.san_src

    def test_non_string_returns_empty(self):
        """esc() and sanitize() must return '' for non-string input"""
        assert "typeof str!=='string'" in self.san_src or "typeof str !== 'string'" in self.san_src
        assert "typeof html!=='string'" in self.san_src or "typeof html !== 'string'" in self.san_src


# ═══════════════════════════════════════════════════════════════
# 9. 퍼널 추적 (Funnel)
# ═══════════════════════════════════════════════════════════════

class TestFunnelTracking:
    """12단계 퍼널 추적 검증"""

    @pytest.fixture(autouse=True)
    def load_funnel_source(self):
        self.funnel_src = (UTILS / "funnel.js").read_text(encoding="utf-8")

    def test_12_funnel_steps_defined(self):
        """Must define exactly 12 funnel steps"""
        step_count = self.funnel_src.count("id:")
        assert step_count >= 12, f"Need 12 funnel steps, found {step_count}"

    def test_critical_funnel_steps_present(self):
        """Critical conversion steps must be present"""
        critical = ["app_open", "dream_input_start", "paywall_shown",
                    "checkout_started", "checkout_completed"]
        for step in critical:
            assert step in self.funnel_src, f"Critical funnel step '{step}' missing"

    def test_steps_have_order_field(self):
        """Each funnel step must have an order field for sequencing"""
        assert self.funnel_src.count("order:") >= 12

    def test_dropoff_analysis_exists(self):
        """Funnel dropoff analysis function must exist"""
        assert "getFunnelDropoffs" in self.funnel_src


# ═══════════════════════════════════════════════════════════════
# 10. 데이터 일관성 (Cross-module consistency)
# ═══════════════════════════════════════════════════════════════

class TestCrossModuleConsistency:
    """모듈 간 데이터 일관성 검증"""

    def test_payment_and_subscription_prices_match(self):
        """Prices in payment.js and subscription.js must match"""
        payment = (SERVICES / "payment.js").read_text(encoding="utf-8")
        subscription = (SERVICES / "subscription.js").read_text(encoding="utf-8")

        prices = ["1900", "7900", "19900", "2900"]
        for price in prices:
            assert price in payment, f"Price {price} missing from payment.js"
            assert price in subscription, f"Price {price} missing from subscription.js"

    def test_emotion_states_consistent(self):
        """Emotion states in dream-pattern.js must align with emotion.js categories"""
        pattern = (SERVICES / "dream-pattern.js").read_text(encoding="utf-8")
        # Pattern engine states
        assert "평온" in pattern and "불안" in pattern and "공포" in pattern
        assert "기쁨" in pattern and "슬픔" in pattern

    def test_analytics_events_match_funnel(self):
        """Analytics events in payment.js must match funnel step IDs"""
        payment = (SERVICES / "payment.js").read_text(encoding="utf-8")
        funnel = (UTILS / "funnel.js").read_text(encoding="utf-8")

        # checkout_started and checkout_completed should be in both
        assert "checkout_started" in payment and "checkout_started" in funnel
        assert "checkout_completed" in payment and "checkout_completed" in funnel


# ═══════════════════════════════════════════════════════════════
# 보안 게이트: 베타 플래그 / 페이월 우회 방지
# ═══════════════════════════════════════════════════════════════

class TestBetaFlagSecurityGate:
    """BETA_OPEN_ALL=true 가 프로덕션/CI에 배포되면 페이월이 전부 무력화됨.

    이 테스트는 두 가지를 검증한다:
    1. BETA_OPEN_ALL 이 subscription.js 에 단일 export 상수로 존재 (소스 추적 가능)
    2. CI 환경(MONGGEUL_PROD=1 또는 CI=true 설정 시)에서는 BETA_OPEN_ALL=true 가
       금지됨을 명시적으로 주장한다. 로컬 개발 중에는 skip 되어 기존 PASS 를 유지.

    정식 오픈 시 할 일:
      subscription.js 36번 줄을 `export const BETA_OPEN_ALL = false;` 로 바꾸면
      이 테스트가 자동 통과 + 페이월 로직 원복.
    """

    SUBSCRIPTION_SRC = (SERVICES / "subscription.js").read_text(encoding="utf-8")

    def test_beta_open_all_is_declared_as_single_export_constant(self):
        """BETA_OPEN_ALL 이 subscription.js 에서 export const 로 선언됨 (단일 진실점)."""
        assert "export const BETA_OPEN_ALL" in self.SUBSCRIPTION_SRC, (
            "BETA_OPEN_ALL 이 export const 로 선언되지 않음 — 추적 불가능한 전역 변수로 누출 위험"
        )

    def test_beta_open_all_is_false_in_ci_or_prod(self):
        """CI / 프로덕션 환경에서는 BETA_OPEN_ALL=true 금지.

        로컬 개발(MONGGEUL_PROD 미설정 + CI 미설정)에서는 skip 하여 기존 테스트를 방해하지 않는다.
        배포 파이프라인(CI=true) 또는 프로덕션 체크(MONGGEUL_PROD=1)에서만 강제.
        """
        is_ci = os.environ.get("CI", "").lower() in ("true", "1", "yes")
        is_prod = os.environ.get("MONGGEUL_PROD", "").lower() in ("true", "1", "yes")
        if not (is_ci or is_prod):
            pytest.skip("로컬 개발 환경 — BETA_OPEN_ALL 플래그 체크 skip (CI/MONGGEUL_PROD 미설정)")

        # CI 또는 PROD 환경에서는 반드시 false 여야 함
        assert "export const BETA_OPEN_ALL = false" in self.SUBSCRIPTION_SRC, (
            "CI/PROD 환경에서 BETA_OPEN_ALL=true 감지 — 페이월 전체 우회 상태로 배포 불가.\n"
            "조치: src/services/subscription.js 의 BETA_OPEN_ALL 을 false 로 변경 후 재빌드."
        )

    def test_beta_open_all_value_is_false(self):
        """BETA_OPEN_ALL 은 항상 false 여야 한다 — skip 없이 항상 단언.

        이 테스트가 FAIL하면 subscription.js line 36을
        `export const BETA_OPEN_ALL = false;` 로 수정해야 배포 가능.
        """
        assert "export const BETA_OPEN_ALL = false" in self.SUBSCRIPTION_SRC, (
            "BETA_OPEN_ALL=true 감지 — 전체 페이월 우회 상태. "
            "src/services/subscription.js line 36을 false 로 수정할 것."
        )
