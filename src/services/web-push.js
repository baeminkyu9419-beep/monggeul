// 몽글몽글 — 웹 푸시 알림 (VAPID)
// 수동 설정 필요: VAPID_PUBLIC_KEY를 config.js에 추가
import { logEvent } from './analytics.js';

const PUSH_ASKED_KEY = 'mg_push_asked';
const PUSH_PREFS_KEY = 'mg_push_prefs';

// 기본 알림 선호
const DEFAULT_PREFS = { morning: true, pattern: true, dali_weekly: true };

export async function initWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!window.VAPID_PUBLIC_KEY) return;
  if (localStorage.getItem(PUSH_ASKED_KEY)) return;

  // 3번째 해몽 후 알림 권한 요청
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  if (logs.length < 3) return;

  localStorage.setItem(PUSH_ASKED_KEY, '1');
  showPushPrompt();
}

function showPushPrompt() {
  const el = document.createElement('div');
  el.id = 'pushPrompt';
  el.style.cssText = 'position:fixed;bottom:80px;left:16px;right:16px;z-index:9995;background:linear-gradient(135deg,#1a1535,#252048);border:1px solid rgba(166,124,239,.25);border-radius:16px;padding:16px;display:flex;align-items:center;gap:12px;animation:slideUp .4s ease;box-shadow:0 8px 32px rgba(0,0,0,.4);';
  el.innerHTML = `
    <div style="font-size:28px">🔔</div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;color:var(--moon,#f5e6b2)">달이의 꿈 알림</div>
      <div style="font-size:11px;color:var(--text-muted,#6b5e8a);margin-top:2px">매일 아침 어젯밤 꿈을 기록하라고 알려드려요</div>
    </div>
    <button onclick="acceptPush()" style="background:linear-gradient(135deg,#7c5cbf,#a67cef);border:none;border-radius:10px;color:white;font-size:12px;font-weight:700;padding:8px 14px;cursor:pointer;white-space:nowrap">좋아요</button>
    <span onclick="document.getElementById('pushPrompt').remove()" style="color:var(--text-muted,#6b5e8a);font-size:14px;cursor:pointer;padding:4px">✕</span>`;
  document.body.appendChild(el);
  logEvent('push_prompt_shown');
}

async function subscribePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY),
    });

    const prefs = getPushPrefs();

    // 서버에 구독 정보 + 알림 선호 전송
    if (window.SUPABASE_URL) {
      await fetch(window.SUPABASE_URL + '/functions/v1/push-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (window.SUPABASE_ANON_KEY || ''),
        },
        body: JSON.stringify({ subscription: sub.toJSON(), prefs }),
      }).catch(() => {});
    }

    logEvent('push_subscribed');
    return true;
  } catch (e) {
    logEvent('push_denied');
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// 알림 선호 관리
export function getPushPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PUSH_PREFS_KEY)) || { ...DEFAULT_PREFS };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function setPushPrefs(prefs) {
  const merged = { ...DEFAULT_PREFS, ...prefs };
  localStorage.setItem(PUSH_PREFS_KEY, JSON.stringify(merged));

  // 서버에도 선호 동기화
  if (window.SUPABASE_URL) {
    navigator.serviceWorker?.ready.then(reg =>
      reg.pushManager.getSubscription()
    ).then(sub => {
      if (!sub) return;
      fetch(window.SUPABASE_URL + '/functions/v1/push-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (window.SUPABASE_ANON_KEY || ''),
        },
        body: JSON.stringify({ subscription: sub.toJSON(), prefs: merged }),
      }).catch(() => {});
    }).catch(() => {});
  }

  logEvent('push_prefs_updated', merged);
  return merged;
}

// 반복꿈 패턴 캐시를 서버에 동기화 (해몽 완료 후 호출)
export async function syncPatternCache(userId, clusters) {
  if (!userId || !window.SUPABASE_URL || !clusters?.length) return;

  // 가장 임박한 예측일 찾기
  const nearest = clusters.reduce((min, c) =>
    c.daysUntil < min.daysUntil ? c : min, clusters[0]);
  const nextDate = new Date(Date.now() + nearest.daysUntil * 86400000)
    .toISOString().split('T')[0];

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    await supabase.from('dream_pattern_cache').upsert({
      user_id: userId,
      clusters,
      next_pattern_date: nextDate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch { /* 실패해도 앱 동작에 영향 없음 */ }
}

// window 노출
window.acceptPush = async function() {
  document.getElementById('pushPrompt')?.remove();
  const ok = await subscribePush();
  if (ok) {
    const { showToast } = await import('../components/toast.js');
    showToast('달이가 매일 아침 알려줄게요 🔔');
  }
};

window.initWebPush = initWebPush;
