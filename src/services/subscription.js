// 몽글몽글 — 구독/결제 시스템 (v4: CLAUDE.md 스펙 통일)
import { store } from '../store.js';
import { esc } from '../utils/sanitize.js';

// ═══════════════════════════════════════
// BM 구조
// ═══════════════════════════════════════
// 무료(비로그인): 기본 해몽 1회 체험
// 무료(로그인): 기본 해몽 2회/일, 꿈 저장 10개
// 상세 해몽 1회: ₩1,900
// 상세 해몽 5회 팩: ₩7,900
// 상세 해몽 15회 팩: ₩19,900
// 무의식 프로파일: ₩2,900
// 프로 구독: ₩9,900/월
// ═══════════════════════════════════════

// ── 상품 정의 ──
export const PRODUCTS = {
  single:   { key: 'monggeul_single',    price: 1900, label: '상세 해몽 1회',     count: 1 },
  pack5:    { key: 'monggeul_pack5',     price: 7900, label: '상세 해몽 5회 팩',  count: 5 },
  pack15:   { key: 'monggeul_pack15',    price: 19900, label: '상세 해몽 15회 팩', count: 15 },
  profile:  { key: 'monggeul_profile',   price: 2900, label: '무의식 프로파일' },
};

export const SKU_MAP = {
  ios:     { single: 'com.monggeul.single', pack5: 'com.monggeul.pack5', pack15: 'com.monggeul.pack15', profile: 'com.monggeul.profile', pro: 'com.monggeul.pro.monthly' },
  android: { single: 'monggeul_single',     pack5: 'monggeul_pack5',     pack15: 'monggeul_pack15',     profile: 'monggeul_profile',      pro: 'monggeul_pro_monthly' },
};

var _cachedCredits = null;
var _cachedSubscription = false;

// ── 프리미엄 해석 크레딧 ──
export function getCredits() {
  if (_cachedCredits !== null) return _cachedCredits;
  return getCreditsLocal();
}

export function getCreditsLocal() {
  return parseInt(localStorage.getItem('mg_premium_credits') || '0');
}

export async function getCreditsAsync() {
  if (store.supabase && store.currentUser) {
    try {
      // 새 entitlements v2 테이블 시도
      const { data: entData, error: entError } = await store.supabase.rpc('check_entitlement', {
        p_user_id: store.currentUser.id,
      });
      if (!entError && entData) {
        const credits = entData.pack_credits ?? 0;
        _cachedCredits = credits;
        _cachedSubscription = entData.has_subscription ?? false;
        localStorage.setItem('mg_premium_credits', String(credits));
        return credits;
      }
    } catch (e) {}

    // 폴백: 기존 user_entitlements 테이블
    try {
      const { data } = await store.supabase
        .from('user_entitlements')
        .select('premium_credits')
        .eq('user_id', store.currentUser.id)
        .single();
      const credits = data?.premium_credits ?? 0;
      _cachedCredits = credits;
      localStorage.setItem('mg_premium_credits', String(credits));
      return credits;
    } catch (e) {}
  }
  return getCreditsLocal();
}

export async function useCredit() {
  const credits = getCredits();
  if (credits <= 0) return false;

  const newCredits = credits - 1;
  _cachedCredits = newCredits;
  localStorage.setItem('mg_premium_credits', String(newCredits));

  if (store.supabase && store.currentUser) {
    try {
      await store.supabase.from('user_entitlements').update({
        premium_credits: newCredits,
        updated_at: new Date().toISOString(),
      }).eq('user_id', store.currentUser.id);
    } catch (e) {}
  }

  updateCreditInfo();
  return true;
}

export async function addCredits(count) {
  const current = getCredits();
  const newCredits = current + count;
  _cachedCredits = newCredits;
  localStorage.setItem('mg_premium_credits', String(newCredits));

  if (store.supabase && store.currentUser) {
    try {
      await store.supabase.from('user_entitlements').upsert({
        user_id: store.currentUser.id,
        premium_credits: newCredits,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {}
  }

  updateCreditInfo();
}

// ── 1차 해석 잠금 해제 (광고 시청 후) ──
export function hasWatchedAd() {
  const today = new Date().toDateString();
  const data = JSON.parse(localStorage.getItem('mg_ad_unlock') || '{}');
  return data.date === today && data.unlocked;
}

export function markAdWatched() {
  const today = new Date().toDateString();
  localStorage.setItem('mg_ad_unlock', JSON.stringify({ date: today, unlocked: true }));
}

// ── UI 업데이트 ──
export function updateCreditInfo() {
  const el = document.getElementById('dreamCountInfo');
  if (!el) return;
  const credits = getCredits();
  if (credits > 0) {
    el.textContent = `프리미엄 해석 ${credits}회 보유 ✨`;
  } else {
    el.textContent = '기본 해몽 무료 · 상세 해몽 ₩1,900';
  }

  // 마지막 꿈 빠른 재실행
  const quickEl = document.getElementById('lastDreamQuick');
  if (quickEl) {
    const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
    if (logs.length > 0 && !logs[0].noDream) {
      quickEl.style.display = 'block';
      const safeText = esc(logs[0].text.substring(0, 30)).replace(/'/g, '&#39;');
      const safeTitle = esc(logs[0].title || '');
      quickEl.innerHTML = `<button onclick="fillDream('${safeText}');analyzeDream()" style="background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:10px;padding:6px 12px;color:var(--purple-bright);font-size:10px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%">🔄 마지막 꿈 다시 해몽: ${safeTitle}</button>`;
    }
  }
}

// ── 티어 판정 (구독 + 크레딧 통합, Gen113 SKU 통일) ──
// 'pro' 는 레거시 별칭 (= 'plus' 동의어). 신규 UI 는 'plus' / 'premium' 직접 사용 권장.
var _cachedEntitlement = 'free';

function normalizeEntitlement(key) {
  if (!key) return 'free';
  if (key === 'pro' || key === 'pro_active' || key === 'plus_active') return 'plus';
  if (key === 'premium_active') return 'premium';
  return key; // free / plus / premium / grace_or_hold 등
}

export async function getUserTier() {
  // Dev unlock: 클라이언트 강제 unlock (개발/오너 사용, 서버 entitlement 무관)
  // 사용: localStorage.setItem('mg_dev_unlock', 'premium') 후 reload
  const devUnlock = (typeof localStorage !== 'undefined') ? localStorage.getItem('mg_dev_unlock') : null;
  if (devUnlock === 'premium' || devUnlock === 'plus') {
    _cachedSubscription = true;
    _cachedEntitlement = devUnlock;
    return devUnlock;
  }
  if (_cachedSubscription) return _cachedEntitlement || 'plus';
  if (store.supabase && store.currentUser) {
    try {
      // 1) RPC check_entitlement (기존 경로)
      const { data } = await store.supabase.rpc('check_entitlement', {
        p_user_id: store.currentUser.id,
      });
      if (data?.has_subscription) {
        _cachedSubscription = true;
        _cachedEntitlement = normalizeEntitlement(data.entitlement_key || data.tier || 'plus');
        return _cachedEntitlement;
      }
    } catch (e) {}
    try {
      // 2) user_entitlements 직접 조회 (Edge Function 이 갱신하는 테이블)
      const { data } = await store.supabase
        .from('user_entitlements')
        .select('entitlement_key, status')
        .eq('user_id', store.currentUser.id)
        .single();
      if (data && (data.status === 'active' || data.status === 'grace')) {
        const tier = normalizeEntitlement(data.entitlement_key);
        if (tier === 'plus' || tier === 'premium') {
          _cachedSubscription = true;
          _cachedEntitlement = tier;
          return tier;
        }
      }
    } catch (e) {}
  }
  return 'free';
}
export function getCachedTier() {
  // Dev unlock 우선 (getUserTier 호출 전이라도 즉시 적용)
  const devUnlock = (typeof localStorage !== 'undefined') ? localStorage.getItem('mg_dev_unlock') : null;
  if (devUnlock === 'premium' || devUnlock === 'plus') return devUnlock;
  if (!_cachedSubscription) return 'free';
  return _cachedEntitlement || 'plus';
}
// ── 일일 해몽 제한 ──
const DAILY_FREE_LIMIT = 2;

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

export function getDreamCountLocal() {
  const data = JSON.parse(localStorage.getItem('mg_daily_dream') || '{}');
  if (data.date !== getTodayKey()) return 0;
  return data.count || 0;
}

export function getDreamCount() {
  return getDreamCountLocal();
}

export async function getDreamCountAsync() {
  if (store.supabase && store.currentUser) {
    try {
      const { data } = await store.supabase
        .from('usage_daily')
        .select('count')
        .eq('user_id', store.currentUser.id)
        .eq('date', getTodayKey())
        .single();
      const count = data?.count ?? 0;
      localStorage.setItem('mg_daily_dream', JSON.stringify({ date: getTodayKey(), count }));
      return count;
    } catch (e) {}
  }
  return getDreamCountLocal();
}

export async function canUseDream() {
  // Dev unlock: 비로그인이라도 mg_dev_unlock 시 무제한 (오너/개발자용)
  const devUnlock = (typeof localStorage !== 'undefined') ? localStorage.getItem('mg_dev_unlock') : null;
  if (devUnlock === 'premium' || devUnlock === 'plus') {
    return { allowed: true, remaining: Infinity };
  }

  // 비로그인: 1회 체험
  if (!store.currentUser) {
    const guestUsed = localStorage.getItem('mg_guest_dream_used');
    return {
      allowed: !guestUsed,
      remaining: guestUsed ? 0 : 1,
      reason: guestUsed ? 'guest_limit' : null,
    };
  }

  // 구독: 무제한 (plus/premium/pro 모두 — pro 는 plus 레거시 별칭)
  const tier = await getUserTier();
  if (tier === 'plus' || tier === 'premium' || tier === 'pro') {
    return { allowed: true, remaining: Infinity };
  }

  // 무료(로그인): 2회/일
  const count = await getDreamCountAsync();
  return {
    allowed: count < DAILY_FREE_LIMIT,
    remaining: Math.max(0, DAILY_FREE_LIMIT - count),
    reason: count >= DAILY_FREE_LIMIT ? 'daily_limit' : null,
  };
}

export async function incDreamCount() {
  const today = getTodayKey();
  const current = getDreamCountLocal();
  const newCount = current + 1;
  localStorage.setItem('mg_daily_dream', JSON.stringify({ date: today, count: newCount }));

  // 비로그인 게스트 체험 마크
  if (!store.currentUser) {
    localStorage.setItem('mg_guest_dream_used', '1');
    return;
  }

  if (store.supabase && store.currentUser) {
    try {
      await store.supabase.rpc('increment_dream_count', { p_user_id: store.currentUser.id });
    } catch (e) {
      // RPC 미배포 시 폴백: upsert
      try {
        await store.supabase
          .from('usage_daily')
          .upsert({ user_id: store.currentUser.id, date: today, count: newCount }, { onConflict: 'user_id,date' });
      } catch (e2) {}
    }
  }
}

export function updateDreamCountInfo() { updateCreditInfo(); }

// ── 달이 프리미엄 추천 게이팅 ──
const DALI_SUGGEST_COOLDOWN_KEY = 'mg_dali_suggest_ts';
const DALI_SUGGEST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24시간

export function canSuggestPremium() {
  // 프로 구독자에게는 추천 안 함
  if (_cachedSubscription) return false;

  // 24시간 내 이미 추천했으면 스킵
  const lastTs = parseInt(localStorage.getItem(DALI_SUGGEST_COOLDOWN_KEY) || '0');
  if (Date.now() - lastTs < DALI_SUGGEST_COOLDOWN_MS) return false;

  return true;
}

export function markPremiumSuggested() {
  localStorage.setItem(DALI_SUGGEST_COOLDOWN_KEY, String(Date.now()));
}

window.getUserTier = getUserTier;
window.getCachedTier = getCachedTier;
window.getCredits = getCredits;
window.useCredit = useCredit;
window.addCredits = addCredits;
window.canUseDream = canUseDream;
window.incDreamCount = incDreamCount;
window.getDreamCount = getDreamCount;
window.getDreamCountAsync = getDreamCountAsync;
window.getDreamCountLocal = getDreamCountLocal;
window.updateDreamCountInfo = updateDreamCountInfo;
window.updateCreditInfo = updateCreditInfo;
window.canSuggestPremium = canSuggestPremium;
window.markPremiumSuggested = markPremiumSuggested;
