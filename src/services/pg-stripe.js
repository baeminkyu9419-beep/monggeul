// 몽글몽글 — Stripe PG 모듈 (카드 결제: 구독 + 단건)
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { isValidUrl } from '../utils/sanitize.js';
import { showPaymentComingSoon } from './payment.js';

// ── Stripe Checkout 세션 시작 ──
export async function startStripeCheckout({ product, orderId }) {
  if (!window.SUPABASE_URL || !store.supabase) {
    showPaymentComingSoon();
    return;
  }

  showToast('결제 페이지로 이동 중...');

  const { data: { session } } = await store.supabase.auth.getSession();

  const res = await fetch(window.SUPABASE_URL + '/functions/v1/create-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (session?.access_token || window.SUPABASE_ANON_KEY),
    },
    body: JSON.stringify({
      product_id: product.id,
      order_id: orderId,
      // 하위호환: 기존 Edge Function이 tier 파라미터를 받는 경우
      tier: product.id === 'pro_monthly' ? 'pro' : product.id,
    }),
  });

  const data = await res.json();

  if (data.url) {
    if (!isValidUrl(data.url)) {
      showToast('결제 URL이 유효하지 않아요 😢');
      return;
    }
    window.location.href = data.url;
  } else {
    showToast(data.error || '결제 준비 중 오류가 발생했어요 😢');
  }
}
