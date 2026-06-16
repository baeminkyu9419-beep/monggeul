// 몽글몽글 — 그로스/수익 파이프라인
// 공유→설치, 레퍼럴, 프로모션, 리텐션 루프
import { store } from '../store.js';
import { logEvent } from './analytics.js';
import { getCachedTier } from './subscription.js';
import { showToast } from '../components/toast.js';
import { esc } from '../utils/sanitize.js';
import { getVariant, trackExposure } from './ab-test.js';
import { trackFunnelStep } from '../utils/funnel.js';
import { selectUpsellTrigger } from './upsell-trigger.js';

// ═══════════════════════════════════════
// 1. 공유 → 앱 설치 유도 (바이럴 루프)
// ═══════════════════════════════════════

const APP_URL = 'https://baeminkyu9419-beep.github.io/monggeul';
// PLAY_URL / IOS_URL: 네이티브 앱 미출시 — 출시 후 이 위치에 추가

export function getShareUrl(referralCode) {
  return `${APP_URL}?ref=${referralCode}`;
}

export function generateReferralCode() {
  const userId = store.currentUser?.id || '';
  // 짧은 코드 생성 (userId 해시 기반)
  const hash = userId.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  return 'mg' + Math.abs(hash).toString(36).substring(0, 6);
}

// 꿈 해몽 결과 공유 (앱 설치 유도 포함)
export async function shareDreamResult(data) {
  const refCode = generateReferralCode();
  const shareUrl = getShareUrl(refCode);

  const shareText = `🌙 오늘 꿈 해몽 결과\n\n` +
    `${data.title}\n` +
    `${(data.badges || []).join(' · ')}\n\n` +
    `나도 꿈 해몽 해보기 👇\n${shareUrl}`;

  logEvent('dream_shared', { title: data.title, ref: refCode });

  if (navigator.share) {
    try {
      await navigator.share({ title: '몽글몽글 꿈 해몽', text: shareText });
      grantShareReward();
    } catch (e) {}
  } else {
    await navigator.clipboard.writeText(shareText);
    showToast('공유 링크가 복사됐어요! 📋');
    grantShareReward();
  }
}

// 달이 대화 공유
export async function shareDaliConversation(msg) {
  const refCode = generateReferralCode();
  const shareText = `🐱 달이와 꿈 이야기\n\n"${msg.substring(0, 100)}..."\n\n나도 달이와 대화하기 👇\n${getShareUrl(refCode)}`;

  logEvent('dali_shared', { ref: refCode });

  if (navigator.share) {
    try { await navigator.share({ title: '달이와 꿈 이야기', text: shareText }); grantShareReward(); } catch (e) {}
  } else {
    await navigator.clipboard.writeText(shareText);
    showToast('공유 링크가 복사됐어요! 📋');
    grantShareReward();
  }
}

// 공유 보상 (XP + 횟수 추적)
function grantShareReward() {
  // 업적용 플래그
  localStorage.setItem('mg_shared', '1');

  const today = new Date().toDateString();
  const shareData = JSON.parse(localStorage.getItem('mg_share_count') || '{}');
  const todayCount = shareData.date === today ? shareData.count : 0;

  if (todayCount < 3) {
    // growth.js 는 addXPSilent 를 import 안 함 → 바레 식별자는 항상 undefined(typeof 가드가 늘 false)였음.
    // my.js 가 window.addXPSilent 로 노출하므로 window 경유로 호출(토스트는 +5 XP 라 했는데 실제 미지급이던 버그).
    if (typeof window.addXPSilent === 'function') window.addXPSilent(5);
    showToast('공유 완료! +5 XP 🎉');
  }

  localStorage.setItem('mg_share_count', JSON.stringify({ date: today, count: todayCount + 1 }));
}

// ═══════════════════════════════════════
// 2. 레퍼럴 추적 (설치 → 가입 시 코드 저장)
// ═══════════════════════════════════════

export function trackReferral() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem('mg_referral', ref);
    logEvent('referral_landed', { ref });
    // URL에서 파라미터 제거
    window.history.replaceState({}, '', window.location.pathname);
  }
}

export async function submitReferral() {
  const ref = localStorage.getItem('mg_referral');
  if (!ref || !store.supabase || !store.currentUser) return;

  try {
    await store.supabase.from('events').insert({
      user_id: store.currentUser.id,
      event: 'referral_converted',
      properties: { referral_code: ref },
    });
    localStorage.removeItem('mg_referral');
  } catch (e) {}
}

// ═══════════════════════════════════════
// 3. 스마트 업셀 (행동 기반 구독 유도)
// ═══════════════════════════════════════

const UPSELL_TRIGGERS = {
  // ── 행동 기반 (기존 3개) ──
  dream_3rd:    { type: 'behavior', msg: '벌써 3번째 해몽! 무제한으로 즐겨보세요', delay: 2000, product: 'pro' },
  dream_7day:   { type: 'behavior', msg: '7일 연속 기록 중! 주간 리포트로 패턴을 발견해보세요', delay: 3000, product: 'weekly_report' },
  dali_deep:    { type: 'behavior', msg: '달이와 깊은 대화 중! 장기 기억 기능으로 더 정확한 해석을 받아보세요', delay: 2000, product: 'pro' },
  // ── 감정별 (3개) ──
  emotion_fear:    { type: 'emotion', msg: '불안한 꿈이 반복되고 있어요. 상세 해몽으로 깊이 살펴볼까요?', delay: 2500, product: 'detail_interpretation' },
  emotion_joy:     { type: 'emotion', msg: '좋은 꿈이 늘고 있어요! 주간 리포트로 감정 변화를 확인해보세요', delay: 2500, product: 'weekly_report' },
  emotion_sadness: { type: 'emotion', msg: '마음이 무거운 꿈이었네요. 상세 해몽으로 숨은 의미를 찾아볼까요?', delay: 2500, product: 'detail_interpretation' },
  // ── 패턴별 (3개) ──
  pattern_repeat:  { type: 'pattern', msg: '같은 꿈이 반복되고 있어요. 무의식 프로파일로 원인을 탐색해보세요', delay: 2000, product: 'unconscious_profile' },
  pattern_symbol:  { type: 'pattern', msg: '이 상징이 자주 나타나고 있어요. 상세 해몽으로 더 깊이 알아볼까요?', delay: 2000, product: 'detail_interpretation' },
  pattern_5dreams: { type: 'pattern', msg: '꿈이 5개 쌓였어요! 무의식 프로파일을 열어볼 수 있어요', delay: 2000, product: 'unconscious_profile' },
  // ── 시간대별 (3개) ──
  time_morning:  { type: 'time', msg: '아침에 꿈을 기록하는 습관, 대단해요! 프로로 더 깊이 분석해보세요', delay: 3000, product: 'pro' },
  time_night:    { type: 'time', msg: '잠들기 전 꿈이 궁금하셨군요. 상세 해몽으로 오늘 밤 꿈을 준비해보세요', delay: 3000, product: 'detail_interpretation' },
  time_weekend:  { type: 'time', msg: '주말엔 꿈이 더 풍부해져요. 5회 팩으로 여유롭게 해몽해보세요', delay: 3000, product: 'detail_interpretation' },
};

// 감정 분류/반복상징/트리거 선택(순수 결정 로직)은 services/upsell-trigger.js 로 추출(2026-06-16).
// classifyEmotion/findRepeatedSymbol/selectUpsellTrigger 는 거기서 import (산식 무변경).

export function checkSmartUpsell() {
  const tier = getCachedTier();
  if (tier !== 'free') return;

  // 오늘 이미 업셀 보여줬으면 스킵
  const today = new Date().toDateString();
  const lastUpsell = localStorage.getItem('mg_last_upsell');
  if (lastUpsell === today) return;

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  const totalChats = parseInt(localStorage.getItem('mg_total_chats') || '0');
  const streak = parseInt(localStorage.getItem('mg_streak') || '0');
  const hour = new Date().getHours();
  const day = new Date().getDay(); // 0=Sun, 6=Sat

  // [2026-05-23] dali_deep 업셀은 숨긴 달이 대화 기능 전제 → FEATURES.dali off면 스킵(가역). 기존 chat 이력 유저 오발동 방지.
  const _daliOn = !(typeof window !== 'undefined' && window.FEATURES && window.FEATURES.dali === false);

  // 순수 결정(우선순위: 패턴 > 감정 > 행동 > 시간대) — services/upsell-trigger.js 로 추출(동작보존)
  const triggerId = selectUpsellTrigger({ logs, totalChats, streak, hour, day, daliOn: _daliOn });

  const trigger = triggerId ? UPSELL_TRIGGERS[triggerId] : null;

  if (trigger) {
    setTimeout(() => {
      showSmartUpsell(trigger.msg, trigger.product);
      localStorage.setItem('mg_last_upsell', today);
      logEvent('smart_upsell_shown', {
        trigger_id: triggerId,
        trigger_type: trigger.type,
        product: trigger.product,
        msg: trigger.msg.substring(0, 30),
      });
    }, trigger.delay);
  }
}

// product → paywall feature 매핑
const PRODUCT_TO_FEATURE = {
  pro: null,  // showPremiumModal
  weekly_report: 'weekly_report',
  detail_interpretation: 'detail_interpretation',
  unconscious_profile: 'unconscious_profile',
};

const PRODUCT_SUBTITLES = {
  pro: 'Plus 구독 월 3,900원',
  weekly_report: '프로 구독에서 확인',
  detail_interpretation: '상세 해몽 1,900원부터',
  unconscious_profile: '무의식 프로파일 2,900원',
};

function showSmartUpsell(msg, product) {
  const banner = document.createElement('div');
  banner.className = 'smart-upsell';

  // A/B: 프로모 톤 실험 (B = 혜택 강조)
  const toneVariant = getVariant('promo_tone_v1');
  trackExposure('promo_tone_v1');
  const BENEFIT_SUBTITLES = {
    pro: '무제한 해몽 + 리포트 + 프로파일 모두 포함',
    weekly_report: '감정 변화와 반복 패턴을 한눈에',
    detail_interpretation: '5단계 심층 분석으로 꿈의 진짜 의미를',
    unconscious_profile: '내 무의식 지도를 펼쳐보세요',
  };
  const subtitle = toneVariant === 'B'
    ? (BENEFIT_SUBTITLES[product] || 'Plus 구독 월 3,900원')
    : (PRODUCT_SUBTITLES[product] || 'Plus 구독 월 3,900원');

  banner.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(124,92,191,.2),rgba(166,124,239,.1));border:1px solid rgba(166,124,239,.25);border-radius:14px;padding:14px 16px;margin:8px 16px;display:flex;align-items:center;gap:12px;animation:slideUp .4s ease;cursor:pointer" data-upsell-product="${esc(product || 'pro')}">
      <span style="font-size:24px">✨</span>
      <div style="flex:1">
        <div style="font-size:12px;color:var(--purple-bright);font-weight:700">${esc(msg)}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${esc(subtitle)}</div>
      </div>
      <span style="font-size:10px;color:var(--text-muted);cursor:pointer" data-upsell-close>✕</span>
    </div>`;

  // 배너 클릭 → 적절한 paywall 열기
  const inner = banner.querySelector('[data-upsell-product]');
  inner.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-upsell-close')) return;
    banner.remove();
    const feature = PRODUCT_TO_FEATURE[product];
    if (feature) {
      if (typeof showPaywall === 'function') showPaywall(feature);
      else window.showPaywall?.(feature);
    } else {
      if (typeof showPremiumModal === 'function') showPremiumModal();
      else window.showPremiumModal?.();
    }
    logEvent('smart_upsell_clicked', { product });
  });

  // X 버튼
  banner.querySelector('[data-upsell-close]').addEventListener('click', (e) => {
    e.stopPropagation();
    banner.remove();
    logEvent('smart_upsell_dismissed', { product });
  });

  // 해몽 탭 상단에 삽입
  const dreamPage = document.getElementById('p-dream');
  if (dreamPage) dreamPage.insertBefore(banner, dreamPage.firstChild);
}

// ═══════════════════════════════════════
// 4. 시간제 프로모션 (첫 구독 할인 등)
// ═══════════════════════════════════════

export function checkPromotion() {
  const tier = getCachedTier();
  if (tier !== 'free') return;

  const joinDate = parseInt(localStorage.getItem('mg_join_date') || String(Date.now()));
  const daysSinceJoin = Math.floor((Date.now() - joinDate) / (1000 * 60 * 60 * 24));
  const promoShown = localStorage.getItem('mg_promo_shown');

  // 가입 3일 후 ~ 7일 사이: 첫 구독 프로모션
  if (daysSinceJoin >= 3 && daysSinceJoin <= 7 && promoShown !== 'v1') {
    setTimeout(() => {
      showPromoModal();
      localStorage.setItem('mg_promo_shown', 'v1');
      logEvent('promo_shown', { type: 'first_week', days: daysSinceJoin });
    }, 5000);
  }
}

function showPromoModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  overlay.innerHTML = `<div style="background:linear-gradient(135deg,#1a1535,#2d1b69);border-radius:20px;padding:28px 24px;max-width:320px;width:100%;text-align:center;border:1px solid rgba(248,201,76,.3);">
    <div style="font-size:40px;margin-bottom:8px">🎁</div>
    <div style="font-size:18px;font-weight:700;color:var(--amber);font-family:'Gowun Dodum',serif;margin-bottom:6px">첫 구독 특별 혜택</div>
    <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">꿈 기록을 시작한 당신에게<br>Plus 플랜으로 무제한 해몽!</div>
    <div style="font-size:24px;font-weight:700;color:var(--moon);margin-bottom:16px">월 3,900원</div>
    <button onclick="this.closest('div[style]').parentElement.remove();subscribePlan('plus')" style="background:linear-gradient(135deg,#f8c94c,#ffaa33);border:none;border-radius:12px;color:#1a1200;font-size:14px;font-weight:700;padding:12px 24px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px">🎁 Plus 시작하기</button>
    <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">다음에 할게요</button>
  </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════
// 5. 리텐션 푸시 (앱 복귀 시 보상)
// ═══════════════════════════════════════

export function checkReturnReward() {
  const lastVisit = localStorage.getItem('mg_last_visit');
  const today = new Date().toDateString();

  if (lastVisit && lastVisit !== today) {
    const lastDate = new Date(lastVisit);
    const daysDiff = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff >= 3) {
      // 3일 이상 안 온 사용자 → 복귀 보상
      setTimeout(() => {
        showToast('다시 와줘서 고마워요! 🌙 +10 XP');
        if (typeof window.addXPSilent === 'function') window.addXPSilent(10);  // 바레 addXPSilent → window 경유(미지급 버그 수정)
        logEvent('return_reward', { days_away: daysDiff });
      }, 2000);
    }
  }

  localStorage.setItem('mg_last_visit', today);
}

// ═══════════════════════════════════════
// 6. PWA 설치 유도 배너 (모바일 웹)
// ═══════════════════════════════════════

export function showAppDownloadBanner() {
  // 네이티브 앱이면 스킵
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) return;
  // 이미 PWA로 설치됨
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  // 이미 닫았으면 스킵
  if (localStorage.getItem('mg_app_banner_dismissed')) return;

  const isMobile = /iPhone|iPad|Android/.test(navigator.userAgent);
  if (!isMobile) return;

  const isIOS = /iPhone|iPad/.test(navigator.userAgent);

  setTimeout(() => {
    const banner = document.createElement('div');
    banner.id = 'appDownloadBanner';
    banner.style.cssText = 'position:fixed;bottom:70px;left:0;right:0;z-index:9990;padding:12px 16px;background:linear-gradient(135deg,#1a1535,#0e0c1a);border-top:1px solid rgba(166,124,239,.2);display:flex;align-items:center;gap:12px;animation:slideUp .4s ease;';
    banner.innerHTML = `
      <div style="font-size:28px">🌙</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:700;color:var(--moon)">홈 화면에 추가</div>
        <div style="font-size:10px;color:var(--text-muted)">${isIOS?'공유 버튼 → 홈 화면에 추가':'앱처럼 빠르게 실행하세요'}</div>
      </div>
      <button onclick="if(window._deferredPrompt){window._deferredPrompt.prompt();window._deferredPrompt=null;this.closest('#appDownloadBanner').remove();}else{alert('브라우저 메뉴에서 \\'홈 화면에 추가\\'를 눌러주세요!')}" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:8px;color:white;font-size:11px;font-weight:700;padding:8px 14px;cursor:pointer;white-space:nowrap">추가</button>
      <span onclick="document.getElementById('appDownloadBanner').remove();localStorage.setItem('mg_app_banner_dismissed','1')" style="color:var(--text-muted);font-size:14px;cursor:pointer;padding:4px">✕</span>`;
    document.body.appendChild(banner);
    logEvent('pwa_install_banner_shown', { platform: isIOS ? 'ios' : 'android' });
  }, 10000);
}

// ═══════════════════════════════════════
// 7. 수익 이벤트 전환 퍼널 추적
// ═══════════════════════════════════════

// 기존 6단계 → 12단계 퍼널 브릿지
const LEGACY_TO_12STEP = {
  app_opened: 'app_open',
  first_dream: 'dream_input_complete',
  second_dream: 'dream_input_complete',
  paywall_seen: 'paywall_shown',
  checkout: 'checkout_started',
  converted: 'checkout_completed',
};

export function trackFunnel(step, meta) {
  // 레거시 step → 12단계 매핑 (호환성 유지)
  const mapped = LEGACY_TO_12STEP[step] || step;
  trackFunnelStep(mapped, meta);
}

// ═══════════════════════════════════════
// 8. 초기화
// ═══════════════════════════════════════

export function initGrowth() {
  trackReferral();
  checkReturnReward();
  checkSmartUpsell();
  checkPromotion();
  showAppDownloadBanner();
  trackFunnel('app_opened');

  // 첫 해몽 완료 시 레퍼럴 제출
  if (store.currentUser) submitReferral();
}

window.shareDreamResult = shareDreamResult;
window.shareDaliConversation = shareDaliConversation;
window.checkSmartUpsell = checkSmartUpsell;
