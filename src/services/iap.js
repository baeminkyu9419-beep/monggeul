// 몽글몽글 — IAP (In-App Purchase) 플랫폼 분기
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { logEvent } from './analytics.js';
import { trackFunnelStep } from '../utils/funnel.js';

// ── 플랫폼 감지 ──
export function isNative() {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
}

export function currentPlatform() {
  if (!isNative()) return 'web';
  return Capacitor.getPlatform(); // 'ios' | 'android'
}

// ── 상품 ID (Gen113 SKU 통일: Plus/Premium 2단 구독 + pro_monthly 레거시 하위호환) ──
// iOS bundle prefix com.monggeul.*, Android package com.monggeul.app
const IOS_PRODUCTS = [
  'com.monggeul.plus.monthly',
  'com.monggeul.premium.monthly',
  'com.monggeul.pro.monthly',  // 레거시 = plus 동의어
  'com.monggeul.single',
  'com.monggeul.pack5',
  'com.monggeul.pack15',
  'com.monggeul.profile',
];
const ANDROID_PRODUCTS = [
  'monggeul_plus',
  'monggeul_premium',
  'monggeul_pro_monthly',      // 레거시 = plus 동의어
  'monggeul_single',
  'monggeul_pack5',
  'monggeul_pack15',
  'monggeul_profile',
];

// ── 구매 ──
export async function purchase(productKey) {
  const platform = currentPlatform();
  logEvent('checkout_started', { tier: productKey, platform });
  trackFunnelStep('checkout_started',{tier:productKey,platform});

  if (platform === 'web') {
    // 웹: payment.js 통합 결제 (카드 기본)
    const { startPayment } = await import('./payment.js');
    // 구독 key 맵: plus/premium 은 엣지 함수 엔티틀먼트 매핑 정본 사용
    const keyMap = {
      single: 'pack_1',
      pack5: 'pack_5',
      pack15: 'pack_15',
      profile: 'unconscious_profile',
      plus: 'plus_monthly',
      premium: 'premium_monthly',
      plus_monthly: 'plus_monthly',
      premium_monthly: 'premium_monthly',
      pro_monthly: 'plus_monthly',   // 레거시 별칭 → 정본 plus
    };
    startPayment({ productId: keyMap[productKey] || productKey, method: 'card' });
    return;
  }

  try {
    if (platform === 'ios') {
      // StoreKit 2 네이티브 브릿지
      // Capacitor 플러그인으로 Product.purchase() 호출
      // 성공 시 transactionId 받음
      const result = await Capacitor.Plugins.MonggeulStore?.purchase({ productId: getIosProductId(productKey) });
      if (!result?.transactionId) { showToast('구매가 취소되었어요'); return; }

      const userId = store.currentUser?.id;
      const res = await store.supabase.functions.invoke('billing-apple-verify', {
        body: { transactionId: result.transactionId, userId },
      });

      if (res.data?.entitlement) {
        logEvent('checkout_completed', { tier: productKey, platform });
        trackFunnelStep('checkout_completed',{tier:productKey,platform});
        showToast('구독이 시작되었어요! ✨');
        window.location.reload();
      }
    }

    if (platform === 'android') {
      // Google Play BillingClient
      // 키 정규화: plus/premium → monggeul_plus / monggeul_premium
      const androidId = getAndroidProductId(productKey);
      const result = await Capacitor.Plugins.MonggeulStore?.purchase({ productId: androidId });
      if (!result?.purchaseToken) { showToast('구매가 취소되었어요'); return; }

      const userId = store.currentUser?.id;
      const res = await store.supabase.functions.invoke('billing-google-verify', {
        body: { purchaseToken: result.purchaseToken, subscriptionId: androidId, userId },
      });

      if (res.data?.entitlement) {
        logEvent('checkout_completed', { tier: productKey, platform });
        showToast('구독이 시작되었어요! ✨');
        window.location.reload();
      }
    }
  } catch (e) {
    logEvent('checkout_abandoned', { tier: productKey, platform, error: String(e) });
    showToast('결제 중 오류가 발생했어요 😢');
  }
}

// ── 복원 (Apple 필수, 없으면 리젝) ──
export async function restorePurchases() {
  const platform = currentPlatform();
  showToast('구독 정보를 확인하는 중...');

  try {
    if (platform === 'ios') {
      // Transaction.currentEntitlements 순회
      const result = await Capacitor.Plugins.MonggeulStore?.restore();
      if (result?.transactionId) {
        const userId = store.currentUser?.id;
        await store.supabase.functions.invoke('billing-apple-verify', {
          body: { transactionId: result.transactionId, userId },
        });
        showToast('구독이 복원되었어요! ✨');
        window.location.reload();
        return true;
      }
    }

    if (platform === 'android') {
      const result = await Capacitor.Plugins.MonggeulStore?.restore();
      if (result?.purchaseToken) {
        const userId = store.currentUser?.id;
        await store.supabase.functions.invoke('billing-google-verify', {
          body: { purchaseToken: result.purchaseToken, subscriptionId: result.subscriptionId, userId },
        });
        showToast('구독이 복원되었어요! ✨');
        window.location.reload();
        return true;
      }
    }

    showToast('복원할 구독이 없어요');
    return false;
  } catch (e) {
    showToast('복원에 실패했어요. 다시 시도해주세요');
    return false;
  }
}

// ── 현재 권한 확인 (서버 기준) ──
export async function getEntitlement() {
  if (!store.supabase || !store.currentUser) {
    return { entitlement_key: 'free', status: 'inactive' };
  }
  const { data } = await store.supabase
    .from('user_entitlements')
    .select('entitlement_key, status, current_period_end')
    .eq('user_id', store.currentUser.id)
    .maybeSingle();  // 0행(신규 유저) 406 방지
  return data || { entitlement_key: 'free', status: 'inactive' };
}

// ── 헬퍼 ──
function getIosProductId(key) {
  if (key === 'plus' || key === 'plus_monthly' || key === 'pro_monthly') return 'com.monggeul.plus.monthly';
  if (key === 'premium' || key === 'premium_monthly') return 'com.monggeul.premium.monthly';
  if (key === 'single') return 'com.monggeul.single';
  if (key === 'pack5') return 'com.monggeul.pack5';
  if (key === 'pack15') return 'com.monggeul.pack15';
  if (key === 'profile') return 'com.monggeul.profile';
  return key;
}

function getAndroidProductId(key) {
  if (key === 'plus' || key === 'plus_monthly' || key === 'pro_monthly') return 'monggeul_plus';
  if (key === 'premium' || key === 'premium_monthly') return 'monggeul_premium';
  if (key === 'single') return 'monggeul_single';
  if (key === 'pack5') return 'monggeul_pack5';
  if (key === 'pack15') return 'monggeul_pack15';
  if (key === 'profile') return 'monggeul_profile';
  return key;
}

window.purchase = purchase;
window.restorePurchases = restorePurchases;
