// 몽글몽글 — Paywall (v5: CLAUDE.md 스펙 통일 — 프로 구독 + 상세해몽 + 무의식 프로파일)
import { showToast } from './toast.js';
import { logEvent } from '../services/analytics.js';
import { trackFunnelStep } from '../utils/funnel.js';
import { getCredits, getCachedTier } from '../services/subscription.js';
import { isNative, purchase } from '../services/iap.js';
import { showRewardedAd, isRewardedReady } from '../services/ads.js';
import { getVariant, trackExposure, trackConversion } from '../services/ab-test.js';

// ── 통합 Paywall (feature별 분기) ──
export function showPaywall(feature) {
  const messages = {
    guest_limit: {
      title: '로그인이 필요해요',
      desc: '로그인하면 하루 2회 무료 해몽을 받을 수 있어요 🌙',
      cta: '로그인하기',
      action: () => { if (typeof showLoginModal === 'function') showLoginModal(); },
    },
    daily_limit: {
      title: '오늘의 무료 해몽을 모두 사용했어요',
      desc: '내일 다시 만나요! 또는 상세 해몽을 이용해보세요 ✨',
      cta: '상세 해몽 알아보기',
      action: () => showPremiumPaywall(),
    },
    detail_interpretation: {
      title: '상세 해몽',
      desc: '무의식 다이브, 5축 운세, 맞춤 조언이 포함된 상세 해몽이에요',
      cta: '상세 해몽 받기 (₩1,900)',
      action: () => showMethodSelect('pack_1'),
    },
    unconscious_profile: {
      title: '무의식 프로파일',
      desc: '꿈 3개 이상 기록하면 무의식 상세 프로파일을 열 수 있어요',
      cta: '프로파일 열기 (₩2,900)',
      action: () => showMethodSelect('unconscious_profile'),
    },
    weekly_report: {
      title: '주간 리포트',
      desc: '지난 7일간의 꿈 흐름 리포트는 프로 구독에서 확인하세요',
      cta: '프로 구독하기 (₩9,900/월)',
      action: () => showMethodSelect('pro_monthly'),
    },
    repeat_dream: {
      title: '반복꿈 감지',
      desc: '반복되는 꿈 패턴 분석은 프로 구독에서 이용하세요',
      cta: '프로 구독하기 (₩9,900/월)',
      action: () => showMethodSelect('pro_monthly'),
    },
  };

  const config = messages[feature] || messages.detail_interpretation;

  // A/B: CTA 문구 실험
  const ctaVariant = getVariant('paywall_cta_v1');
  trackExposure('paywall_cta_v1');
  if (ctaVariant === 'B' && feature === 'detail_interpretation') {
    config.cta = '내 꿈의 숨은 의미 보기 ✨';
  }
  if (ctaVariant === 'B' && feature === 'daily_limit') {
    config.desc = '상세 해몽으로 꿈 속 숨겨진 메시지를 확인해보세요 ✨';
  }

  logEvent('paywall_shown', { feature, variant: ctaVariant });
  trackFunnelStep('paywall_shown',{feature});

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  overlay.innerHTML = `<div style="background:linear-gradient(135deg,#1a1535,#0e0c1a);border-radius:20px;padding:32px 24px;max-width:340px;width:100%;text-align:center;border:1px solid rgba(166,124,239,.2);">
    <div style="font-size:44px;margin-bottom:12px">🌙</div>
    <div style="font-size:17px;font-weight:700;color:var(--moon,#f5e6b2);margin-bottom:8px">${config.title}</div>
    <div style="font-size:13px;color:var(--text-secondary,#a89dd0);line-height:1.7;margin-bottom:20px">${config.desc}</div>
    <button id="paywallCta" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:12px;color:white;font-size:14px;font-weight:700;padding:12px 32px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px">${config.cta}</button>
    <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;color:var(--text-muted,#7a6fa0);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">다음에 할게요</button>
  </div>`;
  overlay.querySelector('#paywallCta').addEventListener('click', () => { overlay.remove(); config.action(); });
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── 1차 해석 잠금 (광고 시청 필요) ──
export function showAdGate() {
  logEvent('ad_gate_shown');
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  overlay.innerHTML = `<div style="background:#1a1535;border-radius:20px;padding:24px 20px;max-width:320px;width:100%;text-align:center;">
    <div style="font-size:36px;margin-bottom:10px">🔮</div>
    <div style="font-size:15px;font-weight:700;color:var(--moon);margin-bottom:6px">1차 해석 보기</div>
    <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">짧은 광고를 보면 에너지 분석과<br>맛보기 해석을 확인할 수 있어요</div>
    <button onclick="this.closest('div[style]').parentElement.remove();unlockWithAd()" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:12px;color:white;font-size:14px;font-weight:700;padding:12px 24px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px">🎬 광고 보고 해석 확인</button>
    <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">나중에 볼게요</button>
  </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── 상세 해몽 결제 모달 (프로 구독 포함) ──
export function showPremiumPaywall() {
  const layoutVariant = getVariant('premium_layout_v1');
  trackExposure('premium_layout_v1');
  logEvent('premium_paywall_shown', { variant: layoutVariant });
  trackFunnelStep('paywall_shown',{feature:'premium_subscription'});
  const credits = getCredits();
  const tier = getCachedTier();

  // 프로 구독 유저는 바로 해제
  if (tier === 'pro') {
    showToast('프로 구독 중이에요! 상세 해몽을 바로 확인하세요 ✨');
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  overlay.innerHTML = `<div style="background:linear-gradient(135deg,#1a1535,#2d1b69);border-radius:20px;padding:28px 20px;max-width:360px;width:100%;text-align:center;border:1px solid rgba(166,124,239,.3);">
    <div style="font-size:36px;margin-bottom:8px">📜</div>
    <div style="font-size:16px;font-weight:700;color:var(--moon);font-family:'Gowun Dodum',serif;margin-bottom:4px">상세 해몽</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">${layoutVariant === 'B' ? '지금 팩으로 구매하면 최대 30% 할인!' : '이 꿈이 진짜 말하려는 게 뭔지 알아보세요'}</div>

    <div style="background:rgba(255,255,255,.03);border-radius:12px;padding:12px;margin-bottom:14px;text-align:left">
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.8">
        🌙 심층 해석 리포트 (전통+심리+현실조언)<br>
        📊 5축 레이더 차트 (재물/건강/연애/직장/가족)<br>
        💬 맞춤형 후속 질문 3개 → 2차 해석<br>
        🧠 무의식 다이브 (4층 심층 분석)<br>
        📖 빅데이터 인사이트 + 행동 처방
      </div>
    </div>

    ${credits > 0 ? `
      <button class="pw-btn pw-credit" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:12px;color:white;font-size:14px;font-weight:700;padding:12px 24px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:6px" data-action="credit">🔓 크레딧 사용 (${credits}회 남음)</button>
    ` : ''}

    <button class="pw-btn" data-action="pack_1" style="background:${credits > 0 ? 'rgba(248,201,76,.15);color:var(--amber,#f8c94c)' : 'linear-gradient(135deg,#f8c94c,#ffaa33);color:#1a1200'};border:${credits > 0 ? '1px solid rgba(248,201,76,.3)' : 'none'};border-radius:12px;font-size:13px;font-weight:700;padding:11px 24px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px">📜 상세 해몽 1회 ₩1,900</button>

    <div style="display:flex;gap:6px;margin-bottom:10px">
      <button class="pw-btn" data-action="pack_5" style="flex:1;background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:10px;padding:10px 8px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;text-align:center">
        <div style="font-size:12px;font-weight:700;color:var(--purple-bright,#a67cef)">5회 팩</div>
        <div style="font-size:15px;font-weight:700;color:var(--moon,#f5e6b2)">₩7,900</div>
        <div style="font-size:9px;color:var(--teal,#5bbfba)">회당 ₩1,580</div>
      </button>
      <button class="pw-btn" data-action="pack_15" style="flex:1;background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:10px;padding:10px 8px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;text-align:center;position:relative">
        <div style="position:absolute;top:-6px;right:6px;background:linear-gradient(135deg,#f8c94c,#ffaa33);border-radius:8px;padding:1px 6px;font-size:8px;font-weight:700;color:#1a1200">최저가</div>
        <div style="font-size:12px;font-weight:700;color:var(--purple-bright,#a67cef)">15회 팩</div>
        <div style="font-size:15px;font-weight:700;color:var(--moon,#f5e6b2)">₩19,900</div>
        <div style="font-size:9px;color:var(--teal,#5bbfba)">회당 ₩1,327</div>
      </button>
    </div>

    <button class="pw-btn" data-action="pro_monthly" style="background:linear-gradient(135deg,rgba(91,191,186,.15),rgba(91,191,186,.05));border:1px solid rgba(91,191,186,.3);border-radius:12px;padding:12px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px;text-align:center">
      <div style="font-size:12px;font-weight:700;color:var(--teal,#5bbfba)">✨ 프로 구독 ₩9,900/월</div>
      <div style="font-size:10px;color:var(--text-muted,#7a6fa0);margin-top:2px">상세해몽 무제한 + 무의식 프로파일 + 주간리포트</div>
    </button>

    <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">기본 해몽만 볼게요</button>
  </div>`;

  // 버튼 이벤트
  overlay.querySelectorAll('.pw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      overlay.remove();
      if (action === 'credit') {
        if (typeof useCreditAndUnlock === 'function') useCreditAndUnlock();
      } else {
        showMethodSelect(action);
      }
    });
  });

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── 무의식 프로파일 Paywall ──
export function showUnconsciousPaywall() {
  logEvent('paywall_shown', { feature: 'unconscious_profile', price: 2900 });
  const tier = getCachedTier();
  if (tier === 'pro') {
    showToast('프로 구독 중이에요! 무의식 프로파일을 바로 확인하세요 ✨');
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  overlay.innerHTML = `<div style="background:linear-gradient(135deg,#1a1535,#2d1b69);border-radius:20px;padding:28px 20px;max-width:340px;width:100%;text-align:center;border:1px solid rgba(91,191,186,.3);">
    <div style="font-size:36px;margin-bottom:8px">🧠</div>
    <div style="font-size:16px;font-weight:700;color:var(--teal,#5bbfba);font-family:'Gowun Dodum',serif;margin-bottom:6px">무의식 프로파일</div>
    <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">당신의 꿈이 말해주는 무의식의 지도를 펼쳐보세요</div>

    <div style="background:rgba(255,255,255,.03);border-radius:12px;padding:12px;margin-bottom:16px;text-align:left">
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.8">
        🔮 무의식 5축 심층 분석 (욕구/불안/성장/관계/자아)<br>
        📊 누적 꿈 데이터 기반 성격 프로파일<br>
        💡 "혹시 평소에 ~한 편 아닌가요?" 인사이트<br>
        🌙 시간에 따른 무의식 변화 추적
      </div>
    </div>

    <button class="pw-btn" data-action="unconscious_profile" style="background:linear-gradient(135deg,#5bbfba,#3d9e99);border:none;border-radius:12px;color:white;font-size:14px;font-weight:700;padding:12px 24px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:6px">🧠 프로파일 열기 ₩2,900</button>

    <button class="pw-btn" data-action="pro_monthly" style="background:rgba(91,191,186,.1);border:1px solid rgba(91,191,186,.2);border-radius:12px;padding:10px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px;text-align:center">
      <div style="font-size:11px;font-weight:700;color:var(--teal,#5bbfba)">프로 구독이면 무료! ₩9,900/월</div>
      <div style="font-size:9px;color:var(--text-muted,#7a6fa0)">상세해몽 무제한 + 프로파일 + 주간리포트</div>
    </button>

    <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">다음에 할게요</button>
  </div>`;

  overlay.querySelectorAll('.pw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.remove();
      showMethodSelect(btn.getAttribute('data-action'));
    });
  });
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── 결제수단 선택 모달 ──
function showMethodSelect(productId) {
  logEvent('method_select_shown', { product_id: productId });

  // 네이티브 앱이면 IAP 직행
  if (isNative()) {
    purchase(productId);
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  overlay.innerHTML = `<div style="background:linear-gradient(135deg,#1a1535,#0e0c1a);border-radius:20px;padding:28px 20px;max-width:320px;width:100%;border:1px solid rgba(166,124,239,.2);">
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:15px;font-weight:700;color:var(--moon,#f5e6b2)">결제수단 선택</div>
      <div style="font-size:11px;color:var(--text-muted,#7a6fa0);margin-top:4px">편한 방법으로 결제하세요</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px" id="methodList">
      <button class="mg-method-btn" data-method="kakaopay" style="display:flex;align-items:center;gap:10px;background:rgba(254,229,0,.08);border:1px solid rgba(254,229,0,.2);border-radius:12px;padding:12px 14px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;text-align:left">
        <span style="font-size:20px;width:28px;text-align:center">💛</span>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fee500">카카오페이</div>
          <div style="font-size:10px;color:var(--text-muted,#7a6fa0)">카카오톡으로 간편 결제</div>
        </div>
      </button>
      <button class="mg-method-btn" data-method="naverpay" style="display:flex;align-items:center;gap:10px;background:rgba(3,199,90,.08);border:1px solid rgba(3,199,90,.2);border-radius:12px;padding:12px 14px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;text-align:left">
        <span style="font-size:20px;width:28px;text-align:center">💚</span>
        <div>
          <div style="font-size:13px;font-weight:700;color:#03c75a">네이버페이</div>
          <div style="font-size:10px;color:var(--text-muted,#7a6fa0)">네이버 앱으로 간편 결제</div>
        </div>
      </button>
      <button class="mg-method-btn" data-method="card" style="display:flex;align-items:center;gap:10px;background:rgba(166,124,239,.08);border:1px solid rgba(166,124,239,.2);border-radius:12px;padding:12px 14px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;text-align:left">
        <span style="font-size:20px;width:28px;text-align:center">💳</span>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--purple-bright,#a67cef)">신용/체크카드</div>
          <div style="font-size:10px;color:var(--text-muted,#7a6fa0)">카드 번호 입력 결제</div>
        </div>
      </button>
      <button class="mg-method-btn" data-method="transfer" style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;text-align:left">
        <span style="font-size:20px;width:28px;text-align:center">🏦</span>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text-secondary,#a89dd0)">계좌이체</div>
          <div style="font-size:10px;color:var(--text-muted,#7a6fa0)">은행 계좌에서 바로 결제</div>
        </div>
      </button>
    </div>

    <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;color:var(--text-muted,#7a6fa0);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;text-align:center">취소</button>
  </div>`;

  // 결제수단 클릭 이벤트
  overlay.querySelectorAll('.mg-method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.getAttribute('data-method');
      overlay.remove();
      startPayment({ productId, method });
    });
  });

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ── payment.js 호출 (lazy import) ──
async function startPayment({ productId, method }) {
  trackConversion('paywall_cta_v1', { product: productId, method });
  trackConversion('premium_layout_v1', { product: productId, method });
  const { startPayment: pay } = await import('../services/payment.js');
  pay({ productId, method });
}

// ── 하위호환 (기존 코드에서 호출되는 함수들) ──
export function showPremiumModal() { showPremiumPaywall(); }
export function closePremiumModal(e) {}
export function closePremiumModalDirect() {
  const modal = document.getElementById('premiumModal');
  if (modal) modal.classList.remove('on');
}
export function subscribePlan(tier) { showMethodSelect('pro_monthly'); }
export function doRestore() {
  if (typeof restorePurchases === 'function') restorePurchases();
}

window.showPaywall = showPaywall;
window.showPremiumModal = showPremiumModal;
window.showPremiumPaywall = showPremiumPaywall;
window.showUnconsciousPaywall = showUnconsciousPaywall;
window.showAdGate = showAdGate;
window.showMethodSelect = showMethodSelect;
window.closePremiumModal = closePremiumModal;
window.closePremiumModalDirect = closePremiumModalDirect;
window.subscribePlan = subscribePlan;
window.doRestore = doRestore;
