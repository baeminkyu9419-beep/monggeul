// 몽글몽글 — Supabase Auth (소셜 로그인: Google/Apple/Kakao/Naver)
import { createClient } from '@supabase/supabase-js';
import { store } from '../store.js';
import { getUserTier, getDreamCountAsync, updateDreamCountInfo, BETA_OPEN_ALL } from './subscription.js';
import { logEvent } from './analytics.js';
import { showToast } from '../components/toast.js';

// ── 초기화 ──
export async function initSupabase() {
  if (!window.SUPABASE_URL) return;
  try {
    store.supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    // OAuth 콜백 처리 (리다이렉트 후 돌아왔을 때)
    const { data: { session } } = await store.supabase.auth.getSession();

    if (session) {
      const { data: { user } } = await store.supabase.auth.getUser();
      store.currentUser = user;
      if (user) {
        await onLoginSuccess(user);
        updateLoginUI(user);
      }
    } else if (BETA_OPEN_ALL) {
      // 정식 오픈 전 — 세션 없으면 자동 익명 로그인 (로그인 화면 없이 바로 해몽 가능)
      try {
        await store.supabase.auth.signInAnonymously();
        const { data: { user } } = await store.supabase.auth.getUser();
        store.currentUser = user;
        if (user) { await onLoginSuccess(user); updateLoginUI(user); }
      } catch (e) {}
    }
    // (정식 오픈 시 BETA_OPEN_ALL=false → 세션 없으면 로그인 화면 표시)

    // Auth 상태 변경 리스너
    store.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        store.currentUser = session.user;
        await onLoginSuccess(session.user);
        updateLoginUI(session.user);
        hideLoginModal();
      } else if (event === 'SIGNED_OUT') {
        store.currentUser = null;
        updateLoginUI(null);
      }
    });
  } catch (e) {
    // supabase init failed — local guest mode available
  }
}

// ── 소셜 로그인 ──
export async function loginWith(provider) {
  if (!store.supabase) return;
  logEvent('login_started', { provider });

  const redirectTo = window.location.origin + window.location.pathname;

  try {
    if (provider === 'kakao') {
      await store.supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: { redirectTo }
      });
    } else if (provider === 'naver') {
      // Supabase 기본 지원 없음 → Custom OIDC 또는 Naver API 직접 연동
      // Supabase에서 Naver를 커스텀 프로바이더로 설정한 경우:
      await store.supabase.auth.signInWithOAuth({
        provider: 'naver',
        options: { redirectTo }
      });
    } else if (provider === 'google') {
      await store.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
    } else if (provider === 'apple') {
      await store.supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo }
      });
    }
  } catch (e) {
    showToast('로그인에 실패했어요. 다시 시도해주세요 🌙');
    // login error — silent
  }
}

// ── 게스트 모드 (익명 로그인 / 오프라인 폴백) ──
export async function loginAsGuest() {
  // Supabase 없으면 로컬 전용 게스트
  if (!store.supabase) {
    enterLocalGuestMode();
    return;
  }
  try {
    await store.supabase.auth.signInAnonymously();
    const { data: { user } } = await store.supabase.auth.getUser();
    store.currentUser = user;
    if (user) {
      await onLoginSuccess(user);
      updateLoginUI(user);
      hideLoginModal();
    }
    logEvent('login_guest');
    localStorage.setItem('mg_login_skipped', '1');
  } catch (e) {
    // Supabase 연결 실패 → 로컬 게스트
    enterLocalGuestMode();
  }
}

function enterLocalGuestMode() {
  const guestId = localStorage.getItem('mg_guest_id') || ('guest_' + Date.now());
  localStorage.setItem('mg_guest_id', guestId);
  localStorage.setItem('mg_login_skipped', '1');
  store.currentUser = { id: guestId, email: null, isLocalGuest: true };
  updateLoginUI(store.currentUser);
  hideLoginModal();
  logEvent('login_local_guest');
}

// ── 로그아웃 ──
export async function logout() {
  if (!store.supabase) return;
  try {
    await store.supabase.auth.signOut();
  } catch (e) {
    showToast('로그아웃 중 오류가 발생했어요. 다시 시도해주세요 🌙');
    return;
  }
  store.currentUser = null;
  updateLoginUI(null);
  showToast('로그아웃 됐어요 🌙');
  logEvent('logout');
}

// ── 로그인 성공 후 처리 ──
async function onLoginSuccess(user) {
  await migrateFromLocalStorage(user.id);
  await Promise.all([getUserTier(), getDreamCountAsync()]);
  updateDreamCountInfo();

  // 세션 확립 후 — 이전에 서버 저장 실패해 큐(mg_dreams_pending_sync)에 쌓인 꿈 재시도.
  // (dream.js 가 동적 로드되어 window 에 노출됨. 아직 미로드면 다음 저장 시 flush 됨.)
  try { window.flushPendingDreamSync?.(); } catch (e) {}

  // 사용자 정보 저장/업데이트
  const meta = user.user_metadata || {};
  const displayName = meta.full_name || meta.name || meta.preferred_username || '';
  if (displayName) {
    localStorage.setItem('mg_nickname', displayName);
    const nickEl = document.getElementById('myNickname');
    if (nickEl) nickEl.textContent = displayName;
  }

  logEvent('login_success', { provider: user.app_metadata?.provider || 'unknown' });
}

// ── UI 업데이트 ──
function updateLoginUI(user) {
  const loginArea = document.getElementById('loginArea');
  const logoutBtn = document.getElementById('logoutBtn');

  if (user) {
    if (loginArea) loginArea.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'block';
  } else {
    if (loginArea) loginArea.style.display = 'block';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// ── 로그인 모달 ──
export function showLoginModal() {
  const existing = document.getElementById('loginModal');
  if (existing) { existing.style.display = 'flex'; return; }

  const modal = document.createElement('div');
  modal.id = 'loginModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease;';
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#1a1535,#0e0c1a);border-radius:24px;padding:32px 24px;max-width:340px;width:100%;text-align:center;border:1px solid rgba(166,124,239,.2);">
      <div style="font-size:44px;margin-bottom:12px">🌙</div>
      <div style="font-size:20px;font-weight:700;color:var(--moon);font-family:'Gowun Dodum',serif;margin-bottom:6px">몽글몽글에 오신 걸 환영해요</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">로그인하면 꿈 기록이 안전하게 저장돼요</div>

      <!-- 필수 동의 체크박스 -->
      <div style="text-align:left;margin-bottom:16px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:10px;">
        <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;cursor:pointer;font-size:11px;color:var(--text-secondary)">
          <input type="checkbox" id="agreeTerms" onchange="checkLoginConsent()" style="margin-top:2px;accent-color:#a67cef">
          <span>[필수] <a href="store/terms-of-service.html" target="_blank" style="color:var(--purple-bright);text-decoration:underline">이용약관</a>에 동의합니다</span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;cursor:pointer;font-size:11px;color:var(--text-secondary)">
          <input type="checkbox" id="agreePrivacy" onchange="checkLoginConsent()" style="margin-top:2px;accent-color:#a67cef">
          <span>[필수] <a href="store/privacy-policy.html" target="_blank" style="color:var(--purple-bright);text-decoration:underline">개인정보 수집·이용</a>에 동의합니다</span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:11px;color:var(--text-secondary)">
          <input type="checkbox" id="agreeThirdParty" onchange="checkLoginConsent()" style="margin-top:2px;accent-color:#a67cef">
          <span>[필수] 개인정보 <a href="store/privacy-policy.html#5" target="_blank" style="color:var(--purple-bright);text-decoration:underline">제3자 제공</a>(OpenAI, AdMob)에 동의합니다</span>
        </label>
        <div style="margin-top:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:8px">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:11px;color:var(--text-muted)">
            <input type="checkbox" id="agreeAll" onchange="toggleAllConsent(this.checked)" style="margin-top:2px;accent-color:#a67cef">
            <span>전체 동의</span>
          </label>
        </div>
      </div>

      <div id="loginButtons" style="opacity:0.3;pointer-events:none;">
        <button onclick="loginWith('kakao')" style="width:100%;padding:12px;border-radius:12px;border:none;background:#FEE500;color:#000;font-size:14px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px">
          <span style="font-size:18px">💬</span> 카카오로 시작하기
        </button>

        <button onclick="loginWith('naver')" style="width:100%;padding:12px;border-radius:12px;border:none;background:#03C75A;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px">
          <span style="font-size:16px;font-weight:900">N</span> 네이버로 시작하기
        </button>

        <button onclick="loginWith('google')" style="width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:#fff;color:#333;font-size:14px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px">
          <span style="font-size:16px">G</span> Google로 시작하기
        </button>

        <button onclick="loginWith('apple')" style="width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:#000;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:'Noto Sans KR',sans-serif;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px">
          <span style="font-size:16px"></span> Apple로 시작하기
        </button>

        <div style="margin:12px 0;display:flex;align-items:center;gap:10px">
          <div style="flex:1;height:1px;background:rgba(255,255,255,.08)"></div>
          <span style="font-size:10px;color:var(--text-muted)">또는</span>
          <div style="flex:1;height:1px;background:rgba(255,255,255,.08)"></div>
        </div>

        <button onclick="loginAsGuest()" style="width:100%;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:transparent;color:var(--text-muted);font-size:12px;cursor:pointer;font-family:'Noto Sans KR',sans-serif">
          로그인 없이 둘러보기
        </button>
      </div>

      <div style="font-size:9px;color:rgba(255,255,255,.2);margin-top:14px;line-height:1.5">
        시작하면 <a href="store/terms-of-service.html" target="_blank" style="color:rgba(166,124,239,.5);text-decoration:none">이용약관</a> 및 <a href="store/privacy-policy.html" target="_blank" style="color:rgba(166,124,239,.5);text-decoration:none">개인정보처리방침</a>에 동의하게 됩니다.
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function hideLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'none';
}

// ── 마이그레이션 (기존 localStorage → Supabase) ──
export async function migrateFromLocalStorage(userId) {
  if (localStorage.getItem('mg_migrated')) return;
  if (!store.supabase) return;
  try {
    const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
    if (logs.length > 0) {
      const rows = logs.filter(l => !l.noDream).map(l => ({
        user_id: userId,
        content: l.text || '',
        title: l.title || '',
        badges: l.badges || [],
        emotions: l.emotions || [],
        created_at: l.id ? new Date(l.id).toISOString() : new Date().toISOString()
      }));
      if (rows.length > 0) await store.supabase.from('dreams').insert(rows);
    }
    const nick = localStorage.getItem('mg_nickname');
    if (nick) await store.supabase.from('users').update({ nickname: nick }).eq('id', userId);
    const mem = localStorage.getItem('mg_dari_memory');
    const chat = localStorage.getItem('mg_chat_hist');
    if (mem || chat) {
      await store.supabase.from('dali_memory').upsert({
        user_id: userId,
        memories: JSON.parse(mem || '[]'),
        chat: JSON.parse(chat || '[]')
      });
    }
    localStorage.setItem('mg_migrated', '1');
  } catch (e) {}
}

window.initSupabase = initSupabase;
// 동의 체크 로직
window.checkLoginConsent = function() {
  const t = document.getElementById('agreeTerms')?.checked;
  const p = document.getElementById('agreePrivacy')?.checked;
  const tp = document.getElementById('agreeThirdParty')?.checked;
  const btns = document.getElementById('loginButtons');
  if (btns) {
    btns.style.opacity = (t && p && tp) ? '1' : '0.3';
    btns.style.pointerEvents = (t && p && tp) ? 'auto' : 'none';
  }
  // 전체 동의 체크 동기화
  const all = document.getElementById('agreeAll');
  if (all) all.checked = (t && p && tp);
};
window.toggleAllConsent = function(checked) {
  ['agreeTerms', 'agreePrivacy', 'agreeThirdParty'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  });
  window.checkLoginConsent();
};

window.loginWith = loginWith;
window.loginAsGuest = loginAsGuest;
window.logout = logout;
window.showLoginModal = showLoginModal;
