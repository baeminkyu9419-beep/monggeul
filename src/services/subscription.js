// 몽글몽글 — 구독/결제 시스템 (v4: CLAUDE.md 스펙 통일)
import { store } from '../store.js';
import { esc } from '../utils/sanitize.js';
import { PRODUCT_CATALOG } from './payment.js';

// ═══════════════════════════════════════
// BM 구조
// ═══════════════════════════════════════
// 무료(비로그인): 기본 해몽 1회 체험
// 무료(로그인): 기본 해몽 2회/일, 꿈 저장 10개
// 상세 해몽 1회: ₩1900
// 상세 해몽 5회 팩: ₩7900
// 상세 해몽 15회 팩: ₩19900
// 무의식 프로파일: ₩2900
// 프로 구독(pro_monthly = plus alias): ₩3900/월 (정본=PRODUCT_CATALOG, 2026-06-14 이중청구 정정)
// ═══════════════════════════════════════

// ── 상품 정의 (PRODUCT_CATALOG 정본 파생 — 금액 중복 정의 금지) ──
// PRODUCT_CATALOG 키: pack_1 / pack_5 / pack_15 / unconscious_profile / pro_monthly / plus_monthly / premium_monthly
// KEEP — 테스트가 소스 존재 단언(계약 핀)
export const PRODUCTS = {
  single:   { key: 'monggeul_single',  price: PRODUCT_CATALOG.pack_1.price,              label: PRODUCT_CATALOG.pack_1.name,   count: PRODUCT_CATALOG.pack_1.count },
  pack5:    { key: 'monggeul_pack5',   price: PRODUCT_CATALOG.pack_5.price,              label: PRODUCT_CATALOG.pack_5.name,   count: PRODUCT_CATALOG.pack_5.count },
  pack15:   { key: 'monggeul_pack15',  price: PRODUCT_CATALOG.pack_15.price,             label: PRODUCT_CATALOG.pack_15.name,  count: PRODUCT_CATALOG.pack_15.count },
  profile:  { key: 'monggeul_profile', price: PRODUCT_CATALOG.unconscious_profile.price, label: PRODUCT_CATALOG.unconscious_profile.name },
};

// KEEP — 테스트가 소스 존재 단언(계약 핀)
export const SKU_MAP = {
  ios:     { single: 'com.monggeul.single', pack5: 'com.monggeul.pack5', pack15: 'com.monggeul.pack15', profile: 'com.monggeul.profile', pro: 'com.monggeul.pro.monthly' },
  android: { single: 'monggeul_single',     pack5: 'monggeul_pack5',     pack15: 'monggeul_pack15',     profile: 'monggeul_profile',      pro: 'monggeul_pro_monthly' },
};

// 정식 오픈 전 — 모든 잠금/제한 해제 (상세해몽·프리미엄·무제한 전부 무료 공개).
// 정식 오픈 시 false 로 되돌리면 결제/제한 로직 원복.
export const BETA_OPEN_ALL = false;

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
    // pending_sync 재시도 (이전 세션 addCredits DB write 실패 복구)
    const pending = localStorage.getItem('mg_credits_pending_sync');
    if (pending !== null) {
      try {
        const { error } = await store.supabase.from('user_entitlements').upsert({
          user_id: store.currentUser.id,
          premium_credits: parseInt(pending),
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        localStorage.removeItem('mg_credits_pending_sync');
      } catch (_) {
        // 여전히 실패 — 플래그 유지하여 다음 세션 재시도.
      }
    }

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
        .maybeSingle();  // 0행(신규 유저) 406 방지
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

  // 2026-06-15: own_ent(RLS) 드롭 이후 client 직접 update 는 거부됨 → 서버 권위 RPC use_credit() 로 차감.
  // RPC = auth.uid() 기준 원자 차감(자기부여 불가, 0 이하 불가), 반환=잔여 크레딧(-1=없음).
  if (store.supabase && store.currentUser) {
    try {
      const { data, error } = await store.supabase.rpc('use_credit');
      if (!error && typeof data === 'number') {
        const remaining = Math.max(0, data);
        _cachedCredits = remaining;
        localStorage.setItem('mg_premium_credits', String(remaining));
        updateCreditInfo();
        return data >= 0;  // -1 = 서버에 크레딧 없음 → 차감 실패
      }
    } catch (e) {}
    // RPC 실패(네트워크/백엔드 다운) → 과금정확성 우선: 낙관적 차감 없이 보류.
    return false;
  }

  // 비로그인/데모: 서버 권위 없음 → localStorage 낙관적 차감만.
  const newCredits = credits - 1;
  _cachedCredits = newCredits;
  localStorage.setItem('mg_premium_credits', String(newCredits));
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
      const { error } = await store.supabase.from('user_entitlements').upsert({
        user_id: store.currentUser.id,
        premium_credits: newCredits,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      // 성공 시 pending_sync 제거
      localStorage.removeItem('mg_credits_pending_sync');
    } catch (e) {
      // DB write 실패 무음 삼킴 방지: 로그 + 다음 세션 재시도용 플래그 기록.
      // 클라이언트(_cachedCredits/localStorage)는 갱신됐으나 서버 미반영 → 재조회 시 0 복원 위험.
      console.error('[monggeul] addCredits DB write failed — pending sync', e);
      localStorage.setItem('mg_credits_pending_sync', String(newCredits));
    }
  }

  updateCreditInfo();
}

// hasWatchedAd 제거 — dead export, 호출부 없음 (2026-06-12)

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
  if (BETA_OPEN_ALL) return 'premium';
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
        .maybeSingle();  // 0행(신규 유저) 406 방지
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
  if (BETA_OPEN_ALL) return 'premium';
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
        .maybeSingle();  // .single()은 0행일 때 406 에러 로깅 → 신규 유저(행 없음)는 정상이므로 maybeSingle
      const count = data?.count ?? 0;
      localStorage.setItem('mg_daily_dream', JSON.stringify({ date: getTodayKey(), count }));
      return count;
    } catch (e) {}
  }
  return getDreamCountLocal();
}

// ── 꿈 저장 제한 (무료: 10개, Plus/Premium: 무제한) ──
// BM 광고(landing.html) 및 주석(line 10)과 일치.
// BETA_OPEN_ALL=true 구간에는 항상 allowed=true 반환.
// 정식 오픈(BETA_OPEN_ALL=false) 시 dream.js saveDream 에서 호출:
//   const { allowed } = await canSaveDream(logs.length);
//   if (!allowed) { showPaywall('storage_limit'); return; }
export const FREE_STORAGE_LIMIT = 10;

export async function canSaveDream(currentSavedCount) {
  if (BETA_OPEN_ALL) return { allowed: true, remaining: Infinity };
  const devUnlock = (typeof localStorage !== 'undefined') ? localStorage.getItem('mg_dev_unlock') : null;
  if (devUnlock === 'premium' || devUnlock === 'plus') return { allowed: true, remaining: Infinity };
  const tier = await getUserTier();
  if (tier === 'plus' || tier === 'premium' || tier === 'pro') return { allowed: true, remaining: Infinity };
  // 무료 로그인 사용자: 10개 제한
  const count = typeof currentSavedCount === 'number' ? currentSavedCount : 0;
  const remaining = Math.max(0, FREE_STORAGE_LIMIT - count);
  return {
    allowed: count < FREE_STORAGE_LIMIT,
    remaining,
    reason: count >= FREE_STORAGE_LIMIT ? 'storage_limit' : null,
  };
}

export async function canUseDream() {
  if (BETA_OPEN_ALL) return { allowed: true, remaining: Infinity };
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
      // [보안 수정 2026-06-15] p_user_id 제거 — 서버가 auth.uid() 로 결정(IDOR 차단)
      await store.supabase.rpc('increment_dream_count');
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

window.canSaveDream = canSaveDream;
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
