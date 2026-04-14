// 몽글몽글 — 알림 스케줄러 (아침/패턴/달이 알림)
import { logEvent } from './analytics.js';
import { generatePatternReport } from './dream-pattern.js';

const NOTIF_PREFS_KEY = 'mg_notif_prefs';
const LAST_MORNING_KEY = 'mg_notif_morning_last';
const LAST_PATTERN_KEY = 'mg_notif_pattern_last';
const LAST_DALI_KEY = 'mg_notif_dali_last';

// 알림 기본 설정
const DEFAULT_PREFS = {
  morning: true,      // 아침 알림
  pattern: true,      // 패턴 알림
  daliWeekly: true,   // 달이 주간 알림
  morningStart: 8,    // 아침 알림 시작 시간
  morningEnd: 10,     // 아침 알림 종료 시간
};

export function getNotifPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY) || '{}') };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function setNotifPrefs(prefs) {
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify({ ...getNotifPrefs(), ...prefs }));
}

// 오늘 날짜 문자열 (YYYY-MM-DD)
function todayStr() { return new Date().toISOString().split('T')[0]; }

// 이번 주 월요일 날짜 문자열
function thisWeekStr() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

// 알림 권한 확인
function hasNotifPermission() {
  return 'Notification' in window && Notification.permission === 'granted';
}

// 서비스워커로 로컬 알림 표시
async function showLocalNotification(type, title, body, data = {}) {
  if (!hasNotifPermission()) return false;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return false;
    await reg.showNotification(title, {
      body,
      icon: '/monggeul/assets/cat_normal.png',
      badge: '/monggeul/assets/cat_normal.png',
      tag: `monggeul-${type}`,
      data: { url: data.url || '/monggeul/', type, ...data },
      actions: data.actions || [],
    });
    logEvent('local_notif_shown', { type });
    return true;
  } catch { return false; }
}

// ── 1. 아침 알림: "어젯밤 꿈 기록해보세요" ──
export function checkMorningNotification() {
  const prefs = getNotifPrefs();
  if (!prefs.morning) return;

  const now = new Date();
  const hour = now.getHours();
  if (hour < prefs.morningStart || hour >= prefs.morningEnd) return;

  // 오늘 이미 보냈으면 스킵
  if (localStorage.getItem(LAST_MORNING_KEY) === todayStr()) return;

  // 오늘 이미 꿈을 기록했으면 스킵
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  const todayLog = logs.find(l => l.date && l.date.startsWith(todayStr()));
  if (todayLog) return;

  // 최소 1번은 해몽한 사용자에게만
  if (logs.length < 1) return;

  localStorage.setItem(LAST_MORNING_KEY, todayStr());

  const messages = [
    '어젯밤 꿈을 기억하고 있나요? 지금 기록해보세요 🌙',
    '오늘 아침은 어떤 꿈이었나요? 달이가 기다리고 있어요 💤',
    '꿈은 시간이 지나면 흐려져요. 지금 바로 기록해보세요 ✨',
    '좋은 아침이에요! 어젯밤 꿈 이야기를 들려주세요 🌅',
  ];
  const body = messages[Math.floor(Math.random() * messages.length)];

  showLocalNotification('morning', '🌙 몽글몽글', body, {
    url: '/monggeul/?tab=dream',
  });
}

// ── 2. 패턴 알림: "반복꿈 주기가 다가왔어요" ──
export function checkPatternNotification() {
  const prefs = getNotifPrefs();
  if (!prefs.pattern) return;

  // 하루 1번만
  if (localStorage.getItem(LAST_PATTERN_KEY) === todayStr()) return;

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  if (logs.length < 3) return;

  const report = generatePatternReport(logs);
  if (!report || !report.clusters || report.clusters.length === 0) return;

  // daysUntil이 0~2일인 클러스터 찾기
  const upcoming = report.clusters.find(c => c.daysUntil >= 0 && c.daysUntil <= 2);
  if (!upcoming) return;

  localStorage.setItem(LAST_PATTERN_KEY, todayStr());

  const body = upcoming.daysUntil === 0
    ? `"${upcoming.keyword}" 관련 꿈이 오늘 다시 나타날 수 있어요. ${upcoming.count}번째 반복이에요!`
    : `"${upcoming.keyword}" 반복꿈 주기가 ${upcoming.daysUntil}일 후 다가와요. 패턴을 확인해보세요`;

  showLocalNotification('pattern', '🔄 반복꿈 알림', body, {
    url: '/monggeul/?tab=log',
  });
  logEvent('pattern_notif_triggered', { keyword: upcoming.keyword, daysUntil: upcoming.daysUntil });
}

// ── 3. 달이 알림: "달이가 이번 주 꿈 정리해뒀어요" ──
export function checkDaliWeeklyNotification() {
  const prefs = getNotifPrefs();
  if (!prefs.daliWeekly) return;

  // 이번 주 이미 보냈으면 스킵
  if (localStorage.getItem(LAST_DALI_KEY) === thisWeekStr()) return;

  // 일요일 or 월요일에만 발송
  const day = new Date().getDay();
  if (day !== 0 && day !== 1) return;

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  // 지난 7일간 꿈이 2개 이상이어야 리포트 의미 있음
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentLogs = logs.filter(l => l.date && new Date(l.date).getTime() > weekAgo);
  if (recentLogs.length < 2) return;

  localStorage.setItem(LAST_DALI_KEY, thisWeekStr());

  showLocalNotification('dali_weekly', '🐱 달이의 주간 정리', `달이가 이번 주 꿈 ${recentLogs.length}개를 정리해뒀어요. 주간 리포트를 확인해보세요!`, {
    url: '/monggeul/?tab=chat',
  });
  logEvent('dali_weekly_notif_triggered', { dreamCount: recentLogs.length });
}

// ── 통합 스케줄러 ──
let _schedulerTimer = null;

export function initNotificationScheduler() {
  // 즉시 체크
  runScheduledChecks();

  // 30분마다 재체크 (앱이 열려있는 동안)
  if (_schedulerTimer) clearInterval(_schedulerTimer);
  _schedulerTimer = setInterval(runScheduledChecks, 30 * 60 * 1000);

  // 앱 포그라운드 복귀 시 체크
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runScheduledChecks();
  });
}

function runScheduledChecks() {
  try { checkMorningNotification(); } catch {}
  try { checkPatternNotification(); } catch {}
  try { checkDaliWeeklyNotification(); } catch {}
}

// ── 알림 설정 UI 렌더링 ──
export function renderNotifSettings(container) {
  const prefs = getNotifPrefs();
  const permitted = hasNotifPermission();

  container.innerHTML = `
    <div style="padding:16px 0">
      <div style="font-size:14px;font-weight:700;color:var(--moon,#f5e6b2);margin-bottom:12px">🔔 알림 설정</div>
      ${!permitted ? `<div style="font-size:11px;color:#e8a87c;background:rgba(232,168,124,.1);border-radius:10px;padding:10px 12px;margin-bottom:12px">알림 권한이 꺼져있어요. 브라우저 설정에서 알림을 허용해주세요.</div>` : ''}
      <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(166,124,239,.1);cursor:pointer">
        <div>
          <div style="font-size:13px;color:var(--text,#d4c8e8)">아침 꿈 기록 알림</div>
          <div style="font-size:10px;color:var(--text-muted,#6b5e8a)">매일 8~10시, 꿈 기록 안내</div>
        </div>
        <input type="checkbox" id="notifMorning" ${prefs.morning ? 'checked' : ''} onchange="window._updateNotifPref('morning',this.checked)" style="accent-color:#a67cef;width:18px;height:18px">
      </label>
      <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(166,124,239,.1);cursor:pointer">
        <div>
          <div style="font-size:13px;color:var(--text,#d4c8e8)">반복꿈 패턴 알림</div>
          <div style="font-size:10px;color:var(--text-muted,#6b5e8a)">반복꿈 주기가 다가올 때</div>
        </div>
        <input type="checkbox" id="notifPattern" ${prefs.pattern ? 'checked' : ''} onchange="window._updateNotifPref('pattern',this.checked)" style="accent-color:#a67cef;width:18px;height:18px">
      </label>
      <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;cursor:pointer">
        <div>
          <div style="font-size:13px;color:var(--text,#d4c8e8)">달이 주간 리포트 알림</div>
          <div style="font-size:10px;color:var(--text-muted,#6b5e8a)">매주 일요일, 주간 꿈 정리</div>
        </div>
        <input type="checkbox" id="notifDali" ${prefs.daliWeekly ? 'checked' : ''} onchange="window._updateNotifPref('daliWeekly',this.checked)" style="accent-color:#a67cef;width:18px;height:18px">
      </label>
    </div>`;
}

window._updateNotifPref = function(key, value) {
  setNotifPrefs({ [key]: value });
  logEvent('notif_pref_changed', { key, value });
};
