// 몽글몽글 — 수면 체크인 + 아침 체크인 (Phase 2-1)
// 수면시간/카페인/운동/스트레스 기록 + 수면 만족도/꿈 선명도

import { showToast } from './toast.js';
import { logEvent } from '../services/analytics.js';

const STORAGE_KEY = 'mg_sleep_logs';

function getSleepLogs() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}
function saveSleepLogs(logs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function getTodayLog() {
  const logs = getSleepLogs();
  return logs.find(l => l.date === todayKey()) || null;
}

// ── 수면 체크인 모달 (취침 전) ──
export function showSleepCheckin() {
  let modal = document.getElementById('sleepCheckinModal');
  if (modal) { modal.style.display = 'block'; return; }

  modal = document.createElement('div');
  modal.id = 'sleepCheckinModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.95);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;animation:su .3s ease';

  const existing = getTodayLog();
  const bedHour = existing?.bedtime || '23';
  const sleepHours = existing?.sleepHours || '7';
  const caffeine = existing?.caffeine || false;
  const exercise = existing?.exercise || false;
  const stress = existing?.stress || 3;

  modal.innerHTML = `<div style="max-width:360px;width:100%;background:var(--card-bg);border:1px solid rgba(166,124,239,.15);border-radius:20px;padding:24px;max-height:90vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:16px;font-weight:900;color:var(--moon)">🌙 수면 체크인</div>
      <button onclick="closeSleepCheckin()" style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer">✕</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px;line-height:1.5">오늘의 수면 환경을 기록하면 꿈과의 연관성을 분석할 수 있어요</div>

    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">💤 수면 시간</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="scBedtime" style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;color:var(--text-primary);padding:8px;font-size:12px">
          ${Array.from({ length: 12 }, (_, i) => {
            const h = (20 + i) % 24;
            const label = h >= 12 ? '오후 ' + (h === 12 ? 12 : h - 12) + '시' : '오전 ' + h + '시';
            return `<option value="${h}" ${h === parseInt(bedHour) ? 'selected' : ''}>${label}</option>`;
          }).join('')}
        </select>
        <span style="color:var(--text-muted);font-size:11px">취침</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
        <input type="range" id="scHours" min="3" max="12" step="0.5" value="${sleepHours}" style="flex:1;accent-color:#a67cef" oninput="document.getElementById('scHoursVal').textContent=this.value+'시간'">
        <span id="scHoursVal" style="font-size:11px;color:var(--purple-bright);min-width:45px">${sleepHours}시간</span>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">☕ 오늘 카페인 섭취</div>
      <div style="display:flex;gap:8px">
        <button class="sc-toggle ${caffeine ? 'on' : ''}" data-field="caffeine" data-val="true" onclick="toggleSCOption(this)" style="flex:1;padding:8px;border-radius:10px;font-size:11px;cursor:pointer;background:${caffeine ? 'rgba(166,124,239,.15)' : 'rgba(255,255,255,.04)'};border:1px solid ${caffeine ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)'};color:var(--text-primary)">☕ 마셨어요</button>
        <button class="sc-toggle ${!caffeine ? 'on' : ''}" data-field="caffeine" data-val="false" onclick="toggleSCOption(this)" style="flex:1;padding:8px;border-radius:10px;font-size:11px;cursor:pointer;background:${!caffeine ? 'rgba(166,124,239,.15)' : 'rgba(255,255,255,.04)'};border:1px solid ${!caffeine ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)'};color:var(--text-primary)">🚫 안 마셨어요</button>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">🏃 오늘 운동</div>
      <div style="display:flex;gap:8px">
        <button class="sc-toggle ${exercise ? 'on' : ''}" data-field="exercise" data-val="true" onclick="toggleSCOption(this)" style="flex:1;padding:8px;border-radius:10px;font-size:11px;cursor:pointer;background:${exercise ? 'rgba(166,124,239,.15)' : 'rgba(255,255,255,.04)'};border:1px solid ${exercise ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)'};color:var(--text-primary)">💪 했어요</button>
        <button class="sc-toggle ${!exercise ? 'on' : ''}" data-field="exercise" data-val="false" onclick="toggleSCOption(this)" style="flex:1;padding:8px;border-radius:10px;font-size:11px;cursor:pointer;background:${!exercise ? 'rgba(166,124,239,.15)' : 'rgba(255,255,255,.04)'};border:1px solid ${!exercise ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)'};color:var(--text-primary)">🛋️ 안 했어요</button>
      </div>
    </div>

    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">😰 스트레스 수준</div>
      <div style="display:flex;gap:6px;justify-content:center" id="scStressRow">
        ${[1, 2, 3, 4, 5].map(v => `<button onclick="selectStress(${v})" class="sc-stress ${v === stress ? 'on' : ''}" style="width:44px;height:44px;border-radius:12px;border:1px solid ${v === stress ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)'};background:${v === stress ? 'rgba(166,124,239,.15)' : 'rgba(255,255,255,.04)'};font-size:16px;cursor:pointer;color:var(--text-primary)">${['😊', '🙂', '😐', '😟', '😫'][v - 1]}</button>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:4px;padding:0 8px"><span>낮음</span><span>높음</span></div>
    </div>

    <button onclick="saveSleepCheckin()" style="width:100%;padding:12px;background:linear-gradient(135deg,#a67cef,#7c5cbf);border:none;border-radius:14px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">저장하기 🌙</button>
  </div>`;

  document.body.appendChild(modal);
  logEvent('sleep_checkin_shown');
}

// ── 아침 체크인 모달 ──
export function showMorningCheckin() {
  let modal = document.getElementById('morningCheckinModal');
  if (modal) { modal.style.display = 'block'; return; }

  modal = document.createElement('div');
  modal.id = 'morningCheckinModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.95);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;animation:su .3s ease';

  const existing = getTodayLog();
  const satisfaction = existing?.satisfaction || 3;
  const vividness = existing?.vividness || 3;

  modal.innerHTML = `<div style="max-width:360px;width:100%;background:var(--card-bg);border:1px solid rgba(166,124,239,.15);border-radius:20px;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:16px;font-weight:900;color:var(--moon)">☀️ 아침 체크인</div>
      <button onclick="closeMorningCheckin()" style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer">✕</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px;line-height:1.5">오늘 아침 기분을 기록해보세요. 수면과 꿈의 관계를 알 수 있어요.</div>

    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:8px">😴 수면 만족도</div>
      <div style="display:flex;gap:6px;justify-content:center" id="mcSatRow">
        ${[1, 2, 3, 4, 5].map(v => `<button onclick="selectSatisfaction(${v})" class="mc-sat ${v === satisfaction ? 'on' : ''}" style="flex:1;height:44px;border-radius:12px;border:1px solid ${v === satisfaction ? 'rgba(248,201,76,.3)' : 'rgba(255,255,255,.08)'};background:${v === satisfaction ? 'rgba(248,201,76,.12)' : 'rgba(255,255,255,.04)'};font-size:16px;cursor:pointer;color:var(--text-primary)">${['😩', '😔', '😐', '😊', '😁'][v - 1]}</button>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:4px;padding:0 4px"><span>최악</span><span>최고</span></div>
    </div>

    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:8px">🔮 꿈 기억 선명도</div>
      <div style="display:flex;gap:6px;justify-content:center" id="mcVividRow">
        ${[1, 2, 3, 4, 5].map(v => `<button onclick="selectVividness(${v})" class="mc-vivid ${v === vividness ? 'on' : ''}" style="flex:1;height:44px;border-radius:12px;border:1px solid ${v === vividness ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)'};background:${v === vividness ? 'rgba(166,124,239,.12)' : 'rgba(255,255,255,.04)'};font-size:14px;cursor:pointer;color:var(--text-primary)">${['🌑', '🌘', '🌗', '🌖', '🌕'][v - 1]}</button>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:4px;padding:0 4px"><span>전혀 기억 안 남</span><span>영화처럼 선명</span></div>
    </div>

    <button onclick="saveMorningCheckin()" style="width:100%;padding:12px;background:linear-gradient(135deg,#f8c94c,#e0a800);border:none;border-radius:14px;color:#0e0c1a;font-size:13px;font-weight:700;cursor:pointer">저장하기 ��️</button>
  </div>`;

  document.body.appendChild(modal);
  logEvent('morning_checkin_shown');
}

// ── 인터랙션 핸들러 ──
window.toggleSCOption = function(btn) {
  const field = btn.dataset.field;
  btn.parentElement.querySelectorAll('.sc-toggle').forEach(b => {
    b.style.background = 'rgba(255,255,255,.04)';
    b.style.borderColor = 'rgba(255,255,255,.08)';
    b.classList.remove('on');
  });
  btn.style.background = 'rgba(166,124,239,.15)';
  btn.style.borderColor = 'rgba(166,124,239,.3)';
  btn.classList.add('on');
};

window.selectStress = function(v) {
  document.querySelectorAll('#scStressRow .sc-stress').forEach((b, i) => {
    const isOn = i + 1 === v;
    b.style.background = isOn ? 'rgba(166,124,239,.15)' : 'rgba(255,255,255,.04)';
    b.style.borderColor = isOn ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)';
    b.classList.toggle('on', isOn);
  });
};

window.selectSatisfaction = function(v) {
  document.querySelectorAll('#mcSatRow .mc-sat').forEach((b, i) => {
    const isOn = i + 1 === v;
    b.style.background = isOn ? 'rgba(248,201,76,.12)' : 'rgba(255,255,255,.04)';
    b.style.borderColor = isOn ? 'rgba(248,201,76,.3)' : 'rgba(255,255,255,.08)';
    b.classList.toggle('on', isOn);
  });
};

window.selectVividness = function(v) {
  document.querySelectorAll('#mcVividRow .mc-vivid').forEach((b, i) => {
    const isOn = i + 1 === v;
    b.style.background = isOn ? 'rgba(166,124,239,.12)' : 'rgba(255,255,255,.04)';
    b.style.borderColor = isOn ? 'rgba(166,124,239,.3)' : 'rgba(255,255,255,.08)';
    b.classList.toggle('on', isOn);
  });
};

// ── 저장 ──
window.saveSleepCheckin = function() {
  const logs = getSleepLogs();
  const today = todayKey();
  let entry = logs.find(l => l.date === today);
  if (!entry) { entry = { date: today }; logs.unshift(entry); }

  entry.bedtime = document.getElementById('scBedtime').value;
  entry.sleepHours = parseFloat(document.getElementById('scHours').value);
  const caffeineBtn = document.querySelector('#sleepCheckinModal .sc-toggle.on[data-field="caffeine"]');
  entry.caffeine = caffeineBtn ? caffeineBtn.dataset.val === 'true' : false;
  const exerciseBtn = document.querySelector('#sleepCheckinModal .sc-toggle.on[data-field="exercise"]');
  entry.exercise = exerciseBtn ? exerciseBtn.dataset.val === 'true' : false;
  const stressBtn = document.querySelector('#scStressRow .sc-stress.on');
  entry.stress = stressBtn ? Array.from(stressBtn.parentElement.children).indexOf(stressBtn) + 1 : 3;

  saveSleepLogs(logs);
  closeSleepCheckin();
  showToast('수면 체크인 완료! 🌙');
  logEvent('sleep_checkin_saved', { sleepHours: entry.sleepHours, caffeine: entry.caffeine, exercise: entry.exercise, stress: entry.stress });
};

window.saveMorningCheckin = function() {
  const logs = getSleepLogs();
  const today = todayKey();
  let entry = logs.find(l => l.date === today);
  if (!entry) { entry = { date: today }; logs.unshift(entry); }

  const satBtn = document.querySelector('#mcSatRow .mc-sat.on');
  entry.satisfaction = satBtn ? Array.from(satBtn.parentElement.children).indexOf(satBtn) + 1 : 3;
  const vivBtn = document.querySelector('#mcVividRow .mc-vivid.on');
  entry.vividness = vivBtn ? Array.from(vivBtn.parentElement.children).indexOf(vivBtn) + 1 : 3;

  saveSleepLogs(logs);
  closeMorningCheckin();
  showToast('아침 체크인 완료! ☀️');
  logEvent('morning_checkin_saved', { satisfaction: entry.satisfaction, vividness: entry.vividness });
};

window.closeSleepCheckin = function() {
  const m = document.getElementById('sleepCheckinModal');
  if (m) m.style.display = 'none';
};
window.closeMorningCheckin = function() {
  const m = document.getElementById('morningCheckinModal');
  if (m) m.style.display = 'none';
};

window.showSleepCheckin = showSleepCheckin;
window.showMorningCheckin = showMorningCheckin;

// ── 수면 품질 ↔ 꿈 감정 상관관계 차트 ──
export function renderSleepCorrelation(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sleepLogs = getSleepLogs();
  const dreamLogs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);

  if (sleepLogs.length < 3 || dreamLogs.length < 3) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px">수면 체크인 3회 이상 기록하면 상관관계 차트가 나타나요</div>';
    return;
  }

  const STATES = ['공포', '슬픔', '불안', '평온', '기쁨'];
  function classifyEmotion(log) {
    const badges = log.badges || [];
    const emotion = log.emotion || '';
    const text = log.text || '';
    if (badges.includes('흉몽') || /무서|공포|귀신|쫓기/.test(text)) return '공포';
    if (/불안|초조|긴장|스트레스/.test(emotion) || /이빨|추락|시험|지각/.test(text)) return '불안';
    if (/슬픔|그리움|외로|이별/.test(emotion) || /울|이별|죽|헤어/.test(text)) return '슬픔';
    if (badges.includes('길몽') || /기쁨|행복|설렘|해방/.test(emotion)) return '기쁨';
    return '평온';
  }

  // 날짜별 매칭
  const matched = [];
  sleepLogs.forEach(sl => {
    const dream = dreamLogs.find(d => {
      let dDate = (d.date || '').split(' ')[0];
      if (dDate.includes('.')) {
        const p = dDate.split('.');
        if (p.length >= 3) dDate = p[0].trim() + '-' + p[1].trim().padStart(2, '0') + '-' + p[2].trim().padStart(2, '0');
      }
      return dDate === sl.date;
    });
    if (dream) {
      matched.push({
        sleepHours: sl.sleepHours || 7,
        satisfaction: sl.satisfaction || 3,
        stress: sl.stress || 3,
        caffeine: sl.caffeine || false,
        exercise: sl.exercise || false,
        vividness: sl.vividness || 3,
        emotionIdx: STATES.indexOf(classifyEmotion(dream)),
        emotion: classifyEmotion(dream)
      });
    }
  });

  if (matched.length < 2) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px">수면 기록과 꿈이 같은 날짜에 2개 이상 있어야 분석 가능해요</div>';
    return;
  }

  // 상관관계 계산
  function correlation(arr, keyX, keyY) {
    const n = arr.length;
    const xs = arr.map(a => a[keyX]), ys = arr.map(a => a[keyY]);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    return dx === 0 || dy === 0 ? 0 : Math.round(num / Math.sqrt(dx * dy) * 100) / 100;
  }

  const corrs = [
    { label: '수면 시간', key: 'sleepHours', emoji: '💤', r: correlation(matched, 'sleepHours', 'emotionIdx') },
    { label: '스트레스', key: 'stress', emoji: '😰', r: -correlation(matched, 'stress', 'emotionIdx') },
    { label: '만족도', key: 'satisfaction', emoji: '😊', r: correlation(matched, 'satisfaction', 'emotionIdx') },
    { label: '선명도', key: 'vividness', emoji: '🔮', r: correlation(matched, 'vividness', 'emotionIdx') }
  ];

  const STATE_COLOR = { 평온: '#7de8d8', 불안: '#f8c94c', 공포: '#f0a8c8', 기쁨: '#a67cef', 슬픔: '#90b0ff' };

  let html = '<div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:10px">📊 수면 ↔ 꿈 상관관계</div>';
  html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:10px">데이터 ' + matched.length + '일 기준</div>';

  corrs.forEach(c => {
    const absR = Math.abs(c.r);
    const barColor = c.r > 0 ? '#7de8d8' : '#f0a8c8';
    const strength = absR >= 0.7 ? '강한 관계' : absR >= 0.4 ? '보통 관계' : absR >= 0.2 ? '약한 관계' : '관계 없음';
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:14px;width:24px">${c.emoji}</span>
      <span style="font-size:10px;width:50px;color:var(--text-secondary)">${c.label}</span>
      <div style="flex:1;height:8px;background:rgba(255,255,255,.04);border-radius:4px;position:relative;overflow:hidden">
        <div style="position:absolute;left:50%;top:0;width:1px;height:100%;background:rgba(255,255,255,.1)"></div>
        <div style="position:absolute;${c.r >= 0 ? 'left:50%' : 'right:50%'};top:0;height:100%;width:${absR * 50}%;background:${barColor};border-radius:4px;transition:width .6s ease"></div>
      </div>
      <span style="font-size:10px;color:${barColor};width:40px;text-align:right;font-weight:600">${c.r > 0 ? '+' : ''}${c.r}</span>
    </div>`;
  });

  // 인사이트
  const best = corrs.reduce((a, b) => Math.abs(a.r) > Math.abs(b.r) ? a : b);
  if (Math.abs(best.r) >= 0.3) {
    const dir = best.r > 0 ? '높을수록 긍정적인 꿈' : '높을수록 부정적인 꿈';
    html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:8px;padding:8px;background:rgba(255,255,255,.02);border-radius:8px;line-height:1.5">💡 <strong style="color:var(--moon)">${best.label}</strong>이(가) 꿈 감정에 가장 큰 영향 (${dir})</div>`;
  }

  container.innerHTML = html;
}

window.renderSleepCorrelation = renderSleepCorrelation;
