// 몽글몽글 — 토스페이먼츠 PG 모듈 (카카오페이/네이버페이/계좌이체)
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { showPaymentComingSoon } from './payment.js';

// ── 토스 결제수단 코드 매핑 ──
const TOSS_METHOD_MAP = {
  kakaopay:  '카카오페이',
  naverpay:  '네이버페이',
  transfer:  '계좌이체',
  tosspay:   '토스페이',
};

// ── 토스 결제 시작 ──
// 서버에서 토스 결제 준비 → 클라이언트가 토스 결제창으로 리다이렉트
export async function startTossCheckout({ product, orderId, method }) {
  if (!window.SUPABASE_URL || !store.supabase) {
    showPaymentComingSoon();
    return;
  }

  showToast('결제 준비 중...');

  const { data: { session } } = await store.supabase.auth.getSession();
  const siteUrl = window.location.origin + window.location.pathname;

  const res = await fetch(window.SUPABASE_URL + '/functions/v1/toss-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (session?.access_token || window.SUPABASE_ANON_KEY),
    },
    body: JSON.stringify({
      product_id: product.id,
      order_id: orderId,
      method: TOSS_METHOD_MAP[method] || method,
      amount: product.price,
      order_name: product.name,
      success_url: siteUrl,
      fail_url: siteUrl,
    }),
  });

  const data = await res.json();

  if (data.checkout_url) {
    window.location.href = data.checkout_url;
  } else {
    showToast(data.error || '결제 준비에 실패했어요 😢');
  }
}
