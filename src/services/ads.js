// 몽글몽글 — 광고 시스템 (AdMob + 웹 폴백)
// Free 사용자: 광고 노출 / Plus·Premium: 광고 제거
import { store } from '../store.js';
import { getCachedTier } from './subscription.js';
import { logEvent } from './analytics.js';

// ── 설정 ──
const ADMOB_IDS = {
  // 실제 배포 시 AdMob 대시보드에서 발급받은 ID로 교체
  // 아래는 테스트 ID
  android: {
    banner:       'ca-app-pub-3940256099942544/6300978111',  // 테스트
    interstitial: 'ca-app-pub-3940256099942544/1033173712',  // 테스트
    rewarded:     'ca-app-pub-3940256099942544/5224354917',  // 테스트
  },
  ios: {
    banner:       'ca-app-pub-3940256099942544/2934735716',  // 테스트
    interstitial: 'ca-app-pub-3940256099942544/4411468910',  // 테스트
    rewarded:     'ca-app-pub-3940256099942544/1712485313',  // 테스트
  },
};

let adMobPlugin = null;
let isAdFree = false;
let interstitialLoaded = false;
let rewardedLoaded = false;
let interstitialCount = 0; // 전면광고 빈도 제어

// ── 초기화 ──
export async function initAds() {
  const tier = getCachedTier();
  isAdFree = (tier === 'plus' || tier === 'premium' || tier === 'starlight' || tier === 'pro');

  if (isAdFree) {
    hideAllBanners();
    return;
  }

  // 네이티브: AdMob
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
    try {
      const mod = await import('@capacitor-community/admob');
      adMobPlugin = mod.AdMob;
      const platform = Capacitor.getPlatform();

      await adMobPlugin.initialize({
        initializeForTesting: true, // 프로덕션 시 false로 변경
      });

      // 배너 광고 표시
      await showBanner(platform);
      // 전면광고 미리 로드
      await preloadInterstitial(platform);
      // 리워드 광고 미리 로드
      await preloadRewarded(platform);

      logEvent('ads_initialized', { platform });
    } catch (e) {
      void('AdMob init failed:', e);
      showWebBannerFallback();
    }
  } else {
    // 웹: 배너 슬롯만 표시 (AdSense 또는 자체 하우스 광고)
    showWebBannerFallback();
  }
}

// ── 배너 광고 ──
async function showBanner(platform) {
  if (isAdFree || !adMobPlugin) return;
  const ids = ADMOB_IDS[platform] || ADMOB_IDS.android;
  try {
    await adMobPlugin.showBanner({
      adId: ids.banner,
      adSize: 'ADAPTIVE_BANNER',
      position: 'BOTTOM_CENTER',
      margin: 0,
    });
  } catch (e) {
    void('Banner failed:', e);
  }
}

// ── 전면 광고 (해몽 결과 후, 3회에 1번) ──
async function preloadInterstitial(platform) {
  if (isAdFree || !adMobPlugin) return;
  const ids = ADMOB_IDS[platform] || ADMOB_IDS.android;
  try {
    await adMobPlugin.prepareInterstitial({ adId: ids.interstitial });
    interstitialLoaded = true;
  } catch (e) {
    interstitialLoaded = false;
  }
}

export async function showInterstitialIfReady() {
  if (isAdFree) return;
  interstitialCount++;
  // 3회에 1번만 노출 (UX 보호)
  if (interstitialCount % 3 !== 0) return;

  if (adMobPlugin && interstitialLoaded) {
    try {
      await adMobPlugin.showInterstitial();
      logEvent('ad_interstitial_shown');
      interstitialLoaded = false;
      // 다음 전면광고 미리 로드
      const platform = Capacitor.getPlatform();
      preloadInterstitial(platform);
    } catch (e) {}
  }
}

// ── 리워드 광고 (무료 해몽 1회 추가) ──
async function preloadRewarded(platform) {
  if (!adMobPlugin) return;
  const ids = ADMOB_IDS[platform] || ADMOB_IDS.android;
  try {
    await adMobPlugin.prepareRewardVideoAd({ adId: ids.rewarded });
    rewardedLoaded = true;
  } catch (e) {
    rewardedLoaded = false;
  }
}

export async function showRewardedAd() {
  // 웹: 리워드 광고 없으므로 바로 보상 지급
  if (!adMobPlugin) {
    logEvent('ad_rewarded_web_skip');
    return true;
  }
  if (!rewardedLoaded) {
    showToastSafe('광고를 불러오는 중이에요. 잠시 후 다시 시도해주세요');
    return false;
  }
  try {
    const result = await adMobPlugin.showRewardVideoAd();
    logEvent('ad_rewarded_completed');
    rewardedLoaded = false;
    const platform = Capacitor.getPlatform();
    preloadRewarded(platform);
    return true; // 보상 지급 가능
  } catch (e) {
    logEvent('ad_rewarded_dismissed');
    return false;
  }
}

export function isRewardedReady() {
  return rewardedLoaded;
}

// ── 배너 숨기기 (구독 시) ──
export function hideAllBanners() {
  if (adMobPlugin) {
    try { adMobPlugin.removeBanner(); } catch (e) {}
  }
  // 웹 배너도 숨기기
  const webBanners = document.querySelectorAll('.ad-banner-slot');
  webBanners.forEach(el => el.style.display = 'none');
}

// ── 구독 상태 변경 시 호출 ──
export function updateAdStatus(tier) {
  isAdFree = (tier === 'plus' || tier === 'premium' || tier === 'starlight' || tier === 'pro');
  if (isAdFree) {
    hideAllBanners();
  }
}

// ── 웹 폴백 (AdSense 우선, 없으면 하우스 광고) ──
// config.js의 window.ADSENSE_CLIENT / window.ADSENSE_SLOT 사용

function getAdSenseConfig() {
  return {
    client: window.ADSENSE_CLIENT || '',
    slot: window.ADSENSE_SLOT || '',
  };
}

function showWebBannerFallback() {
  if (isAdFree) return;
  const { client, slot } = getAdSenseConfig();
  const slots = document.querySelectorAll('.ad-banner-slot');
  slots.forEach(el => {
    if (el.dataset.adLoaded) return; // 중복 push 방지
    el.style.display = 'block';
    if (client && slot) {
      el.innerHTML = `
        <ins class="adsbygoogle" style="display:block;text-align:center" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
      el.dataset.adLoaded = '1';
      logEvent('adsense_slot_rendered', { slot });
    } else {
      el.innerHTML = `
        <div onclick="showPremiumModal()" style="background:linear-gradient(135deg,rgba(124,92,191,.15),rgba(166,124,239,.1));border:1px solid rgba(166,124,239,.2);border-radius:12px;padding:12px 16px;text-align:center;cursor:pointer;margin:8px 0;">
          <div style="font-size:12px;color:var(--purple-bright);font-weight:700">✨ Plus 플랜으로 광고 없이 이용하세요</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">무제한 해몽 + 주간 리포트 · 월 3,900원</div>
        </div>`;
    }
  });
}

function showToastSafe(msg) {
  if (typeof showToast === 'function') showToast(msg);
}

window.showRewardedAd = showRewardedAd;
window.isRewardedReady = isRewardedReady;
