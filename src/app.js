// 몽글몽글 앱 — ES 모듈 엔트리포인트
import './styles/main.css';
import { store } from './store.js';

// Services
import { callOpenAI } from './services/api.js';
import { initSupabase } from './services/auth.js';
import { getUserTier, getDreamCount, getDreamCountAsync, getDreamCountLocal, incDreamCount, canUseDream, updateDreamCountInfo, getCachedTier } from './services/subscription.js';
import { logEvent } from './services/analytics.js';
import { trackFunnelStep } from './utils/funnel.js';

// Components
import { showToast } from './components/toast.js';
import { showPaywall, showPremiumModal, subscribePlan } from './components/paywall.js';
import { handlePaymentReturn, startPayment } from './services/payment.js';
// checkout.js 제거 (M3): startCheckout → startPayment 직접 호출로 통합
// window.startCheckout 하위호환 — 외부에서 호출 시 plus_monthly 로 라우팅
window.startCheckout = function startCheckout(tier = 'plus') {
  const productId = tier === 'plus' ? 'plus_monthly' : (tier === 'premium' ? 'premium_monthly' : 'plus_monthly');
  return startPayment({ productId, method: 'card' });
};
import './services/iap.js';
import { initAds, showInterstitialIfReady } from './services/ads.js';
import './services/dream-context.js';
import { initGrowth, trackFunnel } from './services/growth.js';
import { initWebPush } from './services/web-push.js';
import { initNotificationScheduler } from './services/notification-scheduler.js';
import { drawRadar, drawDetailRadar } from './components/radar.js';

// Utils
import './utils/symbols.js';
import './utils/sanitize.js';
import { initAuroraScroll } from './utils/aurora-scroll.js';

// 기능 플래그 (가역적 군더더기 숨김)
import { FEATURES } from './config/feature-flags.js';

// [2026-05-23] 핵심 루프 집중: 달이/운세/퀴즈 진입점을 플래그로 숨김(코드 보존, 복원=flag true).
function applyFeatureFlags(){
  try{
    const byOnclick=(needle)=>[...document.querySelectorAll('[onclick]')].filter(el=>(el.getAttribute('onclick')||'').includes(needle));
    // 달이 대화 탭 + 진입 버튼 숨김
    if(!FEATURES.dali){
      const tbChat=document.getElementById('tb-chat'); if(tbChat)tbChat.style.display='none';
      byOnclick("switchTab('chat')").forEach(el=>{ el.style.display='none'; });
      const daliMini=document.getElementById('daliMini'); if(daliMini)daliMini.style.display='none';
      // [2026-05-23] 하단 탭바 그리드 4→가시탭수 로 보정(탭 숨김 시 빈 칸/간격 불균형 방지). 가역.
      const tabbar=document.querySelector('.tabbar');
      if(tabbar){ const visible=[...tabbar.querySelectorAll('.tb')].filter(t=>getComputedStyle(t).display!=='none').length;
        if(visible>0) tabbar.style.gridTemplateColumns='repeat('+visible+',1fr)'; }
    }
    // 운세/퀴즈 진입 버튼 숨김 (동적 카드 버튼은 dream.js 가 FEATURES 확인)
    if(!FEATURES.fortune){ byOnclick('initTodayFortune').forEach(el=>{ el.style.display='none'; }); }
    if(!FEATURES.quiz){
      byOnclick('renderQuiz').forEach(el=>{ el.style.display='none'; });
      byOnclick('initQuiz').forEach(el=>{ el.style.display='none'; });
      const quizCard=document.getElementById('quizCard'); if(quizCard)quizCard.style.display='none';
    }
  }catch(e){ void('feature flags:',e); }
}
window.applyFeatureFlags=applyFeatureFlags;

// Tabs — 동적 import (각 탭이 별도 청크로 분리, 병렬 로드)
// 각 탭 모듈은 로드 시 window에 전역 함수를 자동 등록함
const _loadTabs = Promise.all([
  import('./tabs/dream.js'),
  import('./tabs/dali.js'),
  import('./tabs/community.js'),
  import('./tabs/my.js'),
]);

// 전역 에러 핸들러
window.onerror=function(msg,url,line){
  try{logEvent('js_error',{msg:String(msg).substring(0,100),line});}catch{}
  return true;
};
window.onunhandledrejection=function(e){
  try{logEvent('js_rejection',{msg:String(e.reason).substring(0,100)});}catch{}
};

// 배경 장식 제거됨 (깔끔한 디자인)
(()=>{
})();

// 탭 전환
var _scrollPositions={};
function switchTab(n){
  // 숨김 기능 탭으로의 이동 차단(가역: feature-flags.js dali=true 면 통과)
  if(n==='chat' && !FEATURES.dali){ n='dream'; }
  if(window._haptic)window._haptic();
  // 탭 전환 시 음성 인식 중단
  if(window.stopVoiceInput)window.stopVoiceInput();
  const curActive=document.querySelector('.page.active');
  if(curActive)_scrollPositions[curActive.id]=curActive.scrollTop;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+n).classList.add('active');
  document.getElementById('tb-'+n).classList.add('active');
  const newPage=document.getElementById('page-'+n);
  // chat-pg는 flex 레이아웃 필수
  if(newPage.classList.contains('chat-pg'))newPage.style.display='flex';
  if(newPage&&_scrollPositions[newPage.id])newPage.scrollTop=_scrollPositions[newPage.id];
  const titles={dream:'몽글몽글 🌙 해몽',community:'몽글몽글 💬',chat:'몽글몽글 🐱 달이',log:'몽글몽글 👤 MY'};
  document.title=titles[n]||'몽글몽글 🌙';
  if(n==='dream')trackFunnelStep('tab_dream');
  if(n==='dream'){setTimeout(()=>{const di=document.getElementById('dreamInput');if(di&&!di.value)di.focus();},300);}
  if(n==='chat'){setTimeout(()=>{const m=document.getElementById('chatMsgs');if(m)m.scrollTop=m.scrollHeight;},80);if(window.dariProactiveGreet)window.dariProactiveGreet();}
  if(n==='community'&&window.updateCommunityTab)window.updateCommunityTab();
  if(n==='log'){try{if(window.renderAchievements)window.renderAchievements();}catch(e){}}
}
window.switchTab = switchTab;
window.showInterstitialIfReady = showInterstitialIfReady;
window.switchTabSwipe = switchTabSwipe;
window.trackFunnel = trackFunnel;

// 스와이프 탭 전환
function switchTabSwipe(name,dir){
  // 스와이프 탭 전환 시 음성 인식 중단
  if(window.stopVoiceInput)window.stopVoiceInput();
  const pages=document.querySelectorAll('.page');
  const incoming=document.getElementById('page-'+name);
  if(!incoming||incoming.classList.contains('active'))return;
  const outgoing=document.querySelector('.page.active');

  incoming.style.display=incoming.classList.contains('chat-pg')?'flex':'block';
  incoming.style.transition='none';
  incoming.style.transform=dir==='left'?'translateX(100%)':'translateX(-100%)';
  incoming.style.pointerEvents='none';
  incoming.style.zIndex='2';
  // 강제 리플로우 — display:none→block 후 transform 애니메이션 보장
  incoming.offsetHeight;

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      if(outgoing){
        outgoing.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';
        outgoing.style.transform=dir==='left'?'translateX(-100%)':'translateX(100%)';
        outgoing.style.zIndex='1';
      }
      incoming.style.transition='transform .28s cubic-bezier(.4,0,.2,1)';
      incoming.style.transform='translateX(0)';
    });
  });

  setTimeout(()=>{
    pages.forEach(p=>{
      p.style.cssText='';
      p.classList.remove('active');
    });
    incoming.classList.add('active');
    // chat-pg flex 레이아웃 복원
    if(incoming.classList.contains('chat-pg'))incoming.style.display='flex';
    document.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));
    const tb=document.getElementById('tb-'+name);
    if(tb)tb.classList.add('active');
    if(name==='chat')setTimeout(()=>{const m=document.getElementById('chatMsgs');if(m)m.scrollTop=m.scrollHeight;},80);
    if(name==='community'&&window.updateCommunityTab)window.updateCommunityTab();
  },300);
}

// 스와이프 핸들러
(function(){
  const TABS=['community','chat','dream','room','log'];
  let sx=0,sy=0,stime=0,dragging=false,locked=null;

  function isInDetail(el){return el.closest('#detailPage')||el.closest('#writeSheet');}

  function onStart(x,y){
    sx=x;sy=y;stime=Date.now();dragging=true;locked=null;
  }

  function onMove(x,y){
    if(!dragging||locked)return;
    const dx=Math.abs(x-sx),dy=Math.abs(y-sy);
    if(dx>10||dy>10) locked=dx>dy?'h':'v';
  }

  function onEnd(x,y,el){
    if(!dragging){dragging=false;return;}
    dragging=false;
    const dx=x-sx,dy=y-sy,dt=Date.now()-stime;
    if(dt>500)return;
    const absDx=Math.abs(dx),absDy=Math.abs(dy);
    if(Math.max(absDx,absDy)<44)return;

    const inDetail=isInDetail(el);

    if(inDetail&&el.closest('#detailPage')&&dx>70&&absDx>absDy){closeDetail();return;}
    if(inDetail&&el.closest('#writeSheet')&&dy>70&&absDy>absDx){closeWriteSheet();return;}

    if(!inDetail&&absDx>absDy&&absDx>50){
      const activeTab=document.querySelector('.tb.active')?.id?.replace('tb-','');
      const idx=TABS.indexOf(activeTab);
      if(idx===-1)return;
      const next=dx<0?TABS[idx+1]:TABS[idx-1];
      if(next)switchTabSwipe(next,dx<0?'left':'right');
    }
  }

  document.addEventListener('touchstart',e=>{
    onStart(e.touches[0].clientX,e.touches[0].clientY);
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(e.touches.length===1)onMove(e.touches[0].clientX,e.touches[0].clientY);
  },{passive:true});
  document.addEventListener('touchend',e=>{
    const t=e.changedTouches[0];
    onEnd(t.clientX,t.clientY,e.target);
  },{passive:true});

  document.addEventListener('mousedown',e=>{if(e.button===0)onStart(e.clientX,e.clientY);});
  document.addEventListener('mousemove',e=>{if(dragging)onMove(e.clientX,e.clientY);});
  document.addEventListener('mouseup',e=>{if(e.button===0)onEnd(e.clientX,e.clientY,e.target);});
  document.addEventListener('mouseleave',()=>{dragging=false;locked=null;});
})();


// 네이티브 앱 초기화 (Capacitor)
async function initNative(){
  window._haptic=()=>{};
  try{
    const {StatusBar,Style}=await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({color:'#0e0c1a'});
    await StatusBar.setStyle({style:Style.Dark});
  }catch{}
  try{
    const {App:CapApp}=await import('@capacitor/app');
    CapApp.addListener('backButton',({canGoBack})=>{
      if(!canGoBack)CapApp.exitApp();
    });
  }catch{}
  try{
    const {Haptics,ImpactStyle}=await import('@capacitor/haptics');
    window._haptic=()=>{try{Haptics.impact({style:ImpactStyle.Light});}catch{}};
  }catch{}
}

// 네트워크 상태 감지
window.addEventListener('offline',()=>{if(typeof showToast==='function')showToast('오프라인 상태예요. 일부 기능이 제한될 수 있어요 📡');});
window.addEventListener('online',()=>{if(typeof showToast==='function')showToast('다시 연결됐어요! 🌙');});

// Service Worker 등록
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/monggeul/sw.js').catch(()=>{});
}

// PWA 설치 프롬프트
let _installPrompt=null;
window.addEventListener('beforeinstallprompt',(e)=>{
  e.preventDefault();
  _installPrompt=e;
  // 3번째 해몽 이후 설치 유도
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length>=3&&!localStorage.getItem('mg_pwa_dismissed')){
    setTimeout(showInstallBanner,5000);
  }
});
function showInstallBanner(){
  if(!_installPrompt)return;
  const b=document.createElement('div');
  b.id='installBanner';
  b.style.cssText='position:fixed;bottom:70px;left:16px;right:16px;z-index:9990;background:linear-gradient(135deg,#1a1535,#2d1b69);border:1px solid rgba(166,124,239,.3);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:12px;animation:slideUp .4s ease;';
  b.innerHTML=`
    <span style="font-size:28px">🌙</span>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;color:var(--moon)">홈 화면에 추가하기</div>
      <div style="font-size:10px;color:var(--text-muted)">더 빠르게 꿈 해몽을 시작하세요</div>
    </div>
    <button onclick="installPWA()" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:10px;color:#fff;font-size:12px;font-weight:700;padding:8px 14px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">설치</button>
    <span onclick="document.getElementById('installBanner').remove();localStorage.setItem('mg_pwa_dismissed','1')" style="color:var(--text-muted);font-size:14px;cursor:pointer;padding:4px">✕</span>`;
  document.body.appendChild(b);
}
window.installPWA=async function(){
  if(!_installPrompt)return;
  _installPrompt.prompt();
  const{outcome}=await _installPrompt.userChoice;
  if(outcome==='accepted')logEvent('pwa_installed');
  _installPrompt=null;
  const b=document.getElementById('installBanner');if(b)b.remove();
};

// 딥링크 처리 (?tab=chat 등) + QR 수신
function handleDeepLink(){
  const params=new URLSearchParams(window.location.search);
  const tab=params.get('tab');
  if(tab&&['dream','chat','community','log'].includes(tab)){
    setTimeout(()=>switchTab(tab),500);
  }
  // QR 코드 데이터 수신 (#qr-import=BASE64)
  if(window.location.hash.startsWith('#qr-import=')){
    import('./components/dream-export.js').then(m=>{
      m.handleQRImport(window.location.href);
      history.replaceState(null,'',window.location.pathname+window.location.search);
    }).catch(()=>{});
  }
}

// 앱 평가 유도 (5번째 해몽 이후)
function checkRatingPrompt(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length>=5&&!localStorage.getItem('mg_rating_asked')){
    setTimeout(()=>{
      const overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
      overlay.innerHTML=`<div style="background:#1a1535;border-radius:20px;padding:24px 20px;max-width:300px;width:100%;text-align:center;">
        <div style="font-size:36px;margin-bottom:8px">🌟</div>
        <div style="font-size:15px;font-weight:700;color:var(--moon);margin-bottom:6px">몽글몽글이 마음에 드셨나요?</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">별점을 남겨주시면 큰 힘이 돼요!</div>
        <button onclick="this.closest('div[style]').parentElement.remove();localStorage.setItem('mg_rating_asked','1');logEvent('rating_accepted')" style="background:linear-gradient(135deg,#f8c94c,#ffaa33);border:none;border-radius:12px;color:#1a1200;font-size:13px;font-weight:700;padding:10px 24px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-bottom:8px">⭐ 평가하러 가기</button>
        <button onclick="this.closest('div[style]').parentElement.remove();localStorage.setItem('mg_rating_asked','1')" style="background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">나중에 할게요</button>
      </div>`;
      overlay.onclick=(e)=>{if(e.target===overlay){overlay.remove();localStorage.setItem('mg_rating_asked','1');}};
      document.body.appendChild(overlay);
    },3000);
  }
}

// Store 전역 참조 (감정 태그에서 사용)
window._storeImport = { store };

// 초기화
window.addEventListener("load",async()=>{
  try{ initNative(); }catch(e){ void('native init:',e); }
  try{ handlePaymentReturn(); }catch(e){}
  // 탭 청크 + Supabase 초기화 병렬 로드
  await Promise.allSettled([_loadTabs, initSupabase()]);
  // [2026-05-28] DEMO 모드 명시 — SUPABASE 미설정 시 사용자에게 명확히 알림 (저장/계정/AI 비활성 = 데모 해석만)
  // [2026-06-12] 시각 침습 완화 — hero 상단 풀폭 황금 띠 → 우하단 은은한 코너 칩. 정직 표시·SUPABASE 감지 로직 불변.
  try{
    if(!window.SUPABASE_URL || !store.supabase){
      const chip=document.createElement('div');
      chip.id='demoModeBanner';
      chip.setAttribute('role','status');
      chip.style.cssText='position:fixed;left:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:9999;max-width:min(320px,calc(100vw - 28px));display:flex;align-items:flex-start;gap:7px;background:rgba(26,21,53,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(248,201,76,.32);border-radius:13px;padding:9px 12px;font-size:11.5px;line-height:1.45;text-align:left;color:#e9e2ff;box-shadow:0 6px 22px rgba(0,0,0,.32);opacity:0;transform:translateY(8px);transition:opacity .4s ease,transform .4s ease;cursor:default';
      chip.innerHTML='<span aria-hidden="true" style="font-size:13px;line-height:1.2;flex:none">🌙</span><span><b style="color:#f8c94c;font-weight:700">데모 모드</b> — 로컬에 저장돼요(계정/AI 해몽 미연결). 해석은 기본 사전 기반이에요.</span>';
      document.body.appendChild(chip);
      requestAnimationFrame(()=>{ chip.style.opacity='1'; chip.style.transform='translateY(0)'; });
    }
  }catch(e){ void('demo banner:',e); }
  // 로그인 모달: 온보딩 끝난 뒤에 표시 (겹침 방지). 데모 모드(Supabase 없음) = 로그인 무의미 → 차단.
  if(!store.currentUser && !localStorage.getItem('mg_login_skipped') && window.SUPABASE_URL){
    const waitForOnboarding=()=>{
      if(localStorage.getItem('mg_onboarded')||document.getElementById('onboardingOverlay')?.style.display==='none'){
        setTimeout(()=>{ if(!store.currentUser) showLoginModal(); }, 500);
      }else{
        setTimeout(waitForOnboarding, 1000);
      }
    };
    setTimeout(waitForOnboarding, 2000);
  }
  try{ window.checkStreakReset?.();window.updateStats?.();window.renderLog?.();window.renderFeed?.();window.renderCalendar?.();window.detectRepeatDreams?.();window.initTodaySymbol?.();window.renderPopularStories?.();window.renderDaliMini?.();window.renderDreamPersonality?.();window.renderUnconsciousProfile?.();window.renderAchievements?.();window.renderDreamGallery?.();window.renderNotifSettingsUI?.(); }catch(e){ void('ui init:',e); }
  try{ window.initCommunity?.(); }catch(e){ void('community init:',e); }
  try{ initAds(); }catch(e){ void('ads init:',e); }
  try{ initGrowth(); }catch(e){ void('growth init:',e); }
  trackFunnelStep('app_open');
  try{ initAuroraScroll(); }catch(e){ void('aurora scroll init:',e); }
  try{ initWebPush(); }catch(e){}
  try{ initNotificationScheduler(); }catch(e){}
  // SW 알림 클릭 딥링크
  navigator.serviceWorker?.addEventListener("message",(evt)=>{ if(evt.data?.type==="notif_click"&&evt.data.url){ const tab=new URLSearchParams(evt.data.url.split("?")[1]||"").get("tab"); if(tab)switchTab(tab); } });
  try{ window.restoreDreamDraft?.(); }catch(e){}
  try{ window.showEmotionTagsSection?.();window.initTodayFortune?.();window.initQuiz?.();window.checkNoDreamStatus?.();window.checkYesterdayReview?.(); }catch(e){ void('daily init:',e); }
  try{ window.updateDariLevel?.(); }catch(e){}
  try{ applyFeatureFlags(); }catch(e){}
  // 가입일
  if(!localStorage.getItem('mg_join_date'))localStorage.setItem('mg_join_date',String(Date.now()));
  const joinDays=Math.max(1,Math.floor((Date.now()-parseInt(localStorage.getItem('mg_join_date')))/(1000*60*60*24))+1);
  const joinEl=document.getElementById('myJoinDays');
  // [정직] 로그인 안 된 상태(계정 미연결)에서 "함께한 지 N일째"는 근거 없는 표시.
  // currentUser 있을 때만 누적 일수 노출, 아니면 중립 인사.
  if(joinEl)joinEl.textContent=store.currentUser?('몽글몽글과 함께한 지 '+joinDays+'일째 ✨'):'오늘도 와주셨네요 ✨';
  // 닉네임 복원
  const savedNick=localStorage.getItem('mg_nickname');
  if(savedNick){const ne=document.getElementById('myNickname');if(ne)ne.textContent=savedNick;}
  // 매일 다른 placeholder
  const placeholders=['예) 누군가한테 쫓기는 꿈을 꿨어요...','예) 하늘을 날아다니는 꿈이었어요...','예) 이빨이 빠지는 꿈을 꿨어요...','예) 바다에서 수영하는 꿈...','예) 돈을 줍는 꿈을 꿨어요...','예) 고양이가 나온 꿈이었어요...','예) 옛날 집에 돌아가는 꿈...'];
  const di=document.getElementById('dreamInput');
  if(di)di.placeholder=placeholders[new Date().getDay()];
  // 연속 기록 뱃지
  // 스트릭은 MY 탭에서만 표시
  // [CONVERSION-3] 온보딩(환영 선물) 모달을 앱 진입 즉시 → 첫 꿈 결과 직후로 이동(가치 우선).
  //   첫인상을 모달이 가려 이탈하던 마찰 제거. 트리거는 dream.js showResult(첫 해몽 후 ~2.4s).
  //   예외: 이미 꿈을 기록한 적 있으나 아직 온보딩 안 된 재방문자는 진입 시 1회 노출(선물 누락 방지).
  try{
    const _logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
    if(!localStorage.getItem('mg_onboarded') && _logs.length>0) window.showOnboarding?.();
  }catch(e){}
  // 딥링크 (?tab=chat 등)
  try{ handleDeepLink(); }catch(e){}
  // 앱 평가 유도 (5번째 해몽 이후)
  try{ checkRatingPrompt(); }catch(e){}
});
