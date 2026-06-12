// 몽글몽글 — 결제 추상화 레이어 (Phase 22)
// Stripe(카드) + 토스페이먼츠(카카오/네이버/계좌이체) PG 통합
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { logEvent } from './analytics.js';
import { trackFunnelStep } from '../utils/funnel.js';

// ── 주문번호 생성 ──
export function generateOrderId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `MG_${ts}_${rand}`;
}

// ── 상품 목록 (DB products 테이블과 동기) ──
// 구독 SKU 규칙 (Gen113 통일):
//  - 레거시 `pro_monthly` = Plus 와 동의어 (DB/웹/레거시 클라이언트 호환)
//  - 신규 `plus_monthly` = Plus (엣지 함수 매핑: com.monggeul.plus.monthly / monggeul_plus)
//  - 신규 `premium_monthly` = Premium (엣지 함수 매핑: com.monggeul.premium.monthly / monggeul_premium)
export const PRODUCT_CATALOG = {
  pack_1:              { id: 'pack_1',   name: '상세 해몽 1회',   type: 'pack', price: 1900,  count: 1 },
  pack_5:              { id: 'pack_5',   name: '상세 해몽 5회 팩', type: 'pack', price: 7900,  count: 5 },
  pack_15:             { id: 'pack_15',  name: '상세 해몽 15회 팩', type: 'pack', price: 19900, count: 15 },
  unconscious_profile: { id: 'unconscious_profile', name: '무의식 프로파일', type: 'one_time', price: 2900 },
  pro_monthly:         { id: 'pro_monthly', name: '프로 월간 구독', type: 'subscription', price: 9900, alias_of: 'plus_monthly' },
  plus_monthly:        { id: 'plus_monthly', name: 'Plus 월간 구독', type: 'subscription', price: 3900, entitlement: 'plus' },
  premium_monthly:     { id: 'premium_monthly', name: 'Premium 월간 구독', type: 'subscription', price: 19900, entitlement: 'premium' },
};

// SKU_ALIAS + resolveCanonicalSku 제거 — dead exports, 호출부 없음 (2026-06-12)

// ── 결제수단 → PG 매핑 ──
const METHOD_PG_MAP = {
  card:       'stripe',
  kakaopay:   'toss',
  naverpay:   'toss',
  transfer:   'toss',
  tosspay:    'toss',
};

// ── 결제 시작 (통합 진입점) ──
export async function startPayment({ productId, method = 'card' }) {
  const product = PRODUCT_CATALOG[productId];
  if (!product) {
    showToast('상품 정보를 찾을 수 없어요');
    return;
  }

  // 로그인 확인
  if (!store.supabase || !store.currentUser) {
    showToast('로그인이 필요해요. 잠시 후 다시 시도해주세요 🌙');
    return;
  }

  const pg = METHOD_PG_MAP[method] || 'stripe';
  const orderId = generateOrderId();

  logEvent('checkout_started', { product_id: productId, method, pg });
  trackFunnelStep('checkout_started',{product_id:productId,pg});

  try {
    if (pg === 'stripe') {
      const { startStripeCheckout } = await import('./pg-stripe.js');
      await startStripeCheckout({ product, orderId, method });
    } else if (pg === 'toss') {
      const { startTossCheckout } = await import('./pg-toss.js');
      await startTossCheckout({ product, orderId, method });
    }
  } catch (e) {
    logEvent('checkout_error', { product_id: productId, method, error: String(e) });
    showToast('결제 연결에 실패했어요. 잠시 후 다시 시도해주세요 🌙');
  }
}

// ── 권한 조회 (새 entitlements 테이블 기반) ──
export async function checkEntitlement() {
  if (!store.supabase || !store.currentUser) {
    return { has_subscription: false, pack_credits: 0, can_use: false };
  }

  try {
    const { data, error } = await store.supabase.rpc('check_entitlement', {
      p_user_id: store.currentUser.id,
    });
    if (error) throw error;
    return data || { has_subscription: false, pack_credits: 0, can_use: false };
  } catch (e) {
    // DB 함수 미배포 시 기존 로직 폴백
    return fallbackEntitlementCheck();
  }
}

// usePackCredit 제거 — dead export, 호출부 없음 (2026-06-12)

// ── 결제 리턴 처리 (URL 파라미터) ──
export function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);

  // Stripe 리턴
  if (params.get('checkout') === 'success') {
    showToast('결제가 완료됐어요! ✨');
    logEvent('checkout_completed', { pg: 'stripe' });
    trackFunnelStep('checkout_completed',{pg:'stripe'});
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }
  if (params.get('checkout') === 'cancel') {
    showToast('결제가 취소됐어요. 언제든 다시 시도할 수 있어요 🌙');
    logEvent('checkout_abandoned', { pg: 'stripe' });
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  // 토스 리턴
  if (params.get('paymentKey')) {
    handleTossReturn(params);
    return;
  }

  // 토스 실패
  if (params.get('code') && params.get('message')) {
    showToast(`결제 실패: ${params.get('message')}`);
    logEvent('checkout_abandoned', { pg: 'toss', code: params.get('code') });
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ── 토스 결제 승인 (리턴 후 서버 확인) ──
async function handleTossReturn(params) {
  const paymentKey = params.get('paymentKey');
  const orderId = params.get('orderId');
  const amount = params.get('amount');

  showToast('결제 확인 중...');
  window.history.replaceState({}, '', window.location.pathname);

  try {
    const { data: { session } } = await store.supabase.auth.getSession();
    const res = await fetch(window.SUPABASE_URL + '/functions/v1/toss-confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (session?.access_token || window.SUPABASE_ANON_KEY),
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });

    const result = await res.json();
    if (result.success) {
      showToast('결제가 완료됐어요! ✨');
      logEvent('checkout_completed', { pg: 'toss', order_id: orderId });
      trackFunnelStep('checkout_completed',{pg:'toss'});
    } else {
      showToast(result.error || '결제 확인에 실패했어요 😢');
      logEvent('checkout_error', { pg: 'toss', error: result.error });
    }
  } catch (e) {
    showToast('결제 확인 중 오류가 발생했어요 😢');
  }
}

// ── 폴백: 기존 user_entitlements 테이블 기반 ──
async function fallbackEntitlementCheck() {
  try {
    const { data } = await store.supabase
      .from('user_entitlements')
      .select('premium_credits')
      .eq('user_id', store.currentUser.id)
      .maybeSingle();  // 0행(신규 유저) 406 방지
    const credits = data?.premium_credits ?? 0;
    return { has_subscription: false, pack_credits: credits, can_use: credits > 0 };
  } catch (e) {
    return { has_subscription: false, pack_credits: 0, can_use: false };
  }
}

// ── "준비 중" 모달 (Edge Function 미배포 시) ──
export function showPaymentComingSoon() {
  const existing = document.getElementById('paymentComingSoon');
  if (existing) { existing.style.display = 'flex'; return; }
  const modal = document.createElement('div');
  modal.id = 'paymentComingSoon';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#1a1535,#0e0c1a);border-radius:20px;padding:32px 24px;max-width:320px;width:100%;text-align:center;border:1px solid rgba(166,124,239,.2);">
      <div style="font-size:44px;margin-bottom:12px">🌙</div>
      <div style="font-size:18px;font-weight:700;color:var(--moon,#f5e6b2);margin-bottom:8px">웹 결제 준비 중이에요</div>
      <div style="font-size:13px;color:var(--text-secondary,#a89dd0);line-height:1.7;margin-bottom:20px">현재 웹 결제 시스템을 준비하고 있어요.<br>곧 오픈 예정이니 조금만 기다려주세요!</div>
      <button onclick="this.closest('#paymentComingSoon').style.display='none'" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:12px;color:white;font-size:14px;font-weight:700;padding:12px 32px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">알겠어요</button>
    </div>`;
  document.body.appendChild(modal);
}

window.startPayment = startPayment;
window.handlePaymentReturn = handlePaymentReturn;
