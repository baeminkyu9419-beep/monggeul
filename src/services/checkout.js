// Phase 5: Stripe 결제 연동 (하위호환 유지, 새 결제는 payment.js 경유)
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { isValidUrl } from '../utils/sanitize.js';
import { showPaymentComingSoon } from './payment.js';

export async function startCheckout(tier = 'plus') {
  if (!window.SUPABASE_URL || !store.supabase) {
    showPaymentComingSoon();
    return;
  }
  if (!store.currentUser) {
    showToast('로그인이 필요해요. 잠시 후 다시 시도해주세요 🌙');
    return;
  }

  showToast('결제 페이지로 이동 중...');

  try {
    const { data: { session } } = await store.supabase.auth.getSession();
    const res = await fetch(window.SUPABASE_URL + '/functions/v1/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (session?.access_token || window.SUPABASE_ANON_KEY),
      },
      body: JSON.stringify({ tier }),
    });

    const data = await res.json();

    if (data.url) {
      if(!isValidUrl(data.url)){showToast('결제 URL이 유효하지 않아요 😢');return;}
      window.location.href = data.url;
    } else {
      showToast('결제 준비 중 오류가 발생했어요 😢');
    }
  } catch (e) {
    showToast('결제 연결에 실패했어요. 잠시 후 다시 시도해주세요 🌙');
  }
}

window.startCheckout = startCheckout;
