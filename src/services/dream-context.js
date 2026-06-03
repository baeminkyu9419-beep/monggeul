// 몽글몽글 — 꿈 맥락 CRM (개인 맞춤형 해몽)
// 사용자의 현재 상황, 감정, 추억을 저장해서 다음 해몽에 반영

import { store } from '../store.js';
import { logEvent } from './analytics.js';
import { esc } from '../utils/sanitize.js';

const CONTEXT_KEY = 'mg_dream_context';

// ── 사용자 맥락 저장/조회 ──
export function getUserContext() {
  try { return JSON.parse(localStorage.getItem(CONTEXT_KEY) || '{}'); }
  catch { return {}; }
}

export function saveUserContext(ctx) {
  const existing = getUserContext();
  const merged = { ...existing, ...ctx, updatedAt: new Date().toISOString() };
  localStorage.setItem(CONTEXT_KEY, JSON.stringify(merged));

  // Supabase에도 동기화
  if (store.supabase && store.currentUser) {
    store.supabase.from('dali_memory').upsert({
      user_id: store.currentUser.id,
      user_context: merged,
    }).then(() => {});
  }
}

// ── 해몽 후 맞춤 질문 생성 ──
export function getFollowUpQuestions(data) {
  const questions = [];
  const badges = data.badges || [];
  const emotions = data.emotions || [];
  const title = data.title || '';

  // 감정 기반 질문
  const negativeEmotions = emotions.filter(e =>
    e.includes('무서') || e.includes('불안') || e.includes('슬프') ||
    e.includes('공포') || e.includes('당황') || e.includes('분노')
  );

  if (negativeEmotions.length > 0) {
    questions.push({
      q: '혹시 요즘 스트레스받는 일이 있나요?',
      key: 'currentStress',
      placeholder: '직장, 학교, 관계 등 무엇이든...',
      icon: '😔'
    });
  }

  // 상징 기반 질문
  if (title.includes('전 애인') || title.includes('연인') || title.includes('이별')) {
    questions.push({
      q: '이 꿈과 관련된 추억이 있나요?',
      key: 'relatedMemory',
      placeholder: '그 사람과의 기억, 최근 있었던 일...',
      icon: '💭'
    });
  }

  if (badges.includes('흉몽')) {
    questions.push({
      q: '이런 종류의 꿈을 자주 꾸나요?',
      key: 'dreamFrequency',
      options: ['처음이에요', '가끔 꿔요', '자주 꿔요', '거의 매일'],
      icon: '🔄'
    });
  }

  if (badges.includes('재물운')) {
    questions.push({
      q: '요즘 돈이나 일에 대한 고민이 있나요?',
      key: 'financialConcern',
      placeholder: '이직, 투자, 급여 등...',
      icon: '💰'
    });
  }

  if (badges.includes('연애운')) {
    questions.push({
      q: '현재 연애 상태는 어떤가요?',
      key: 'relationshipStatus',
      options: ['싱글', '썸 타는 중', '연애 중', '복잡한 관계'],
      icon: '💕'
    });
  }

  // 범용 질문 (항상 1개는 포함)
  if (questions.length === 0) {
    questions.push({
      q: '이 꿈을 꿀 때 어떤 기분이었어요?',
      key: 'dreamFeeling',
      placeholder: '무서웠어요, 편안했어요, 신기했어요...',
      icon: '🌙'
    });
  }

  // 생활 상황 (3번째 해몽부터)
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  const ctx = getUserContext();
  if (logs.length >= 3 && !ctx.lifeStage) {
    questions.push({
      q: '요즘 어떤 시기를 보내고 있나요?',
      key: 'lifeStage',
      options: ['학생', '취준생', '직장인', '이직 고민', '연애/결혼', '육아', '은퇴/쉬는 중'],
      icon: '📍'
    });
  }

  return questions.slice(0, 2); // 최대 2개
}

// ── 맞춤 질문 UI ──
export function showContextQuestions(data) {
  const questions = getFollowUpQuestions(data);
  if (questions.length === 0) return;

  const container = document.getElementById('dreamContextArea');
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = `
    <div style="margin-top:16px;background:rgba(125,232,216,.06);border:1px solid rgba(125,232,216,.15);border-radius:14px;padding:14px;">
      <div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:10px;">🐱 달이가 더 정확하게 해석하기 위해 물어봐요</div>
      ${questions.map(q => renderQuestion(q)).join('')}
      <button onclick="submitDreamContext()" style="background:rgba(125,232,216,.15);border:1px solid rgba(125,232,216,.25);border-radius:10px;color:var(--teal);font-size:12px;font-weight:700;padding:8px 16px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;width:100%;margin-top:8px">💾 저장하면 다음 해몽이 더 정확해져요</button>
      <div style="font-size:9px;color:var(--text-muted);margin-top:6px;text-align:center">답변은 기기에만 저장되며 외부로 전송되지 않아요</div>
    </div>`;

  logEvent('context_questions_shown', { count: questions.length });
}

function renderQuestion(q) {
  if (q.options) {
    return `
      <div style="margin-bottom:10px;">
        <div style="font-size:12px;color:var(--text-primary);margin-bottom:6px;">${q.icon} ${esc(q.q)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;" id="ctx_${q.key}">
          ${q.options.map(opt => `
            <button class="ctx-opt" data-key="${q.key}" data-val="${esc(opt)}" onclick="selectContextOption(this)" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:4px 12px;font-size:11px;color:var(--text-secondary);cursor:pointer;font-family:'Noto Sans KR',sans-serif;transition:all .2s">${esc(opt)}</button>
          `).join('')}
        </div>
      </div>`;
  }
  return `
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;color:var(--text-primary);margin-bottom:6px;">${q.icon} ${esc(q.q)}</div>
      <input type="text" id="ctx_${q.key}" placeholder="${esc(q.placeholder || '')}" style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 12px;font-size:14px;color:var(--text-primary);font-family:'Noto Sans KR',sans-serif;outline:none;box-sizing:border-box" />
    </div>`;
}

// ── 옵션 선택 ──
window.selectContextOption = function(btn) {
  const siblings = btn.parentElement.querySelectorAll('.ctx-opt');
  siblings.forEach(b => { b.style.background = 'rgba(255,255,255,.04)'; b.style.borderColor = 'rgba(255,255,255,.1)'; b.style.color = 'var(--text-secondary)'; });
  btn.style.background = 'rgba(125,232,216,.15)';
  btn.style.borderColor = 'rgba(125,232,216,.3)';
  btn.style.color = 'var(--teal)';
  btn.dataset.selected = '1';
};

// ── 제출 ──
window.submitDreamContext = function() {
  const ctx = {};
  document.querySelectorAll('[id^="ctx_"]').forEach(el => {
    const key = el.id.replace('ctx_', '');
    if (el.tagName === 'INPUT') {
      if (el.value.trim()) ctx[key] = el.value.trim();
    } else {
      // 옵션 그룹
      const selected = el.querySelector('[data-selected="1"]');
      if (selected) ctx[key] = selected.dataset.val;
    }
  });

  if (Object.keys(ctx).length > 0) {
    saveUserContext(ctx);
    logEvent('context_submitted', { keys: Object.keys(ctx) });

    const container = document.getElementById('dreamContextArea');
    if (container) {
      container.innerHTML = `
        <div style="margin-top:16px;background:rgba(125,232,216,.06);border:1px solid rgba(125,232,216,.15);border-radius:14px;padding:14px;text-align:center">
          <div style="font-size:14px;color:var(--teal);font-weight:700">💚 저장 완료!</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">다음 해몽부터 달이가 당신을 더 잘 이해할 거예요</div>
        </div>`;
    }
    if (typeof window.showToast === 'function') window.showToast('맥락이 저장됐어요! 다음 해몽이 더 정확해져요 🐱');  // 바레 showToast → window(미표시 버그)
  }
};

// [보안] lifeStage별 해석 지시문(LIFE_STAGE_PROMPTS)은 서버(openai-proxy/prompts.ts)로 이관됨.
// 클라는 lifeStage 키만 보유/전송한다(getLifeStageKey). UI 선택지 키 목록은 아래 getFollowUpQuestions
// options(학생/취준생/직장인/이직 고민/연애·결혼/육아/은퇴·쉬는 중)에 그대로 유지된다.

// ── GPT 프롬프트에 맥락 주입 ──
export function getContextForPrompt() {
  const ctx = getUserContext();
  if (Object.keys(ctx).length === 0) return '';

  const parts = [];
  if (ctx.lifeStage) parts.push(`현재 시기: ${ctx.lifeStage}`);
  if (ctx.currentStress) parts.push(`최근 스트레스: ${ctx.currentStress}`);
  if (ctx.relationshipStatus) parts.push(`연애 상태: ${ctx.relationshipStatus}`);
  if (ctx.financialConcern) parts.push(`재정 고민: ${ctx.financialConcern}`);
  if (ctx.relatedMemory) parts.push(`관련 추억: ${ctx.relatedMemory}`);
  if (ctx.dreamFeeling) parts.push(`꿈 속 감정: ${ctx.dreamFeeling}`);
  if (ctx.dreamFrequency) parts.push(`이 유형 꿈 빈도: ${ctx.dreamFrequency}`);

  if (parts.length === 0) return '';
  return `\n\n【사용자 맥락 (개인화 해석에 활용)】\n${parts.join('\n')}`;
}

// ── lifeStage 기반 시스템 프롬프트 보강 ──
// [보안: 프롬프트 IP 서버 격리]
// 이전: LIFE_STAGE_PROMPTS 해석 지시문을 클라에서 조립해 LLM 으로 전송 → dist 번들 평문 노출.
// 이후: 서버(openai-proxy/prompts.ts)가 lifeStage 키 → 지시문 매핑을 보유. 클라는 키만 전송.
//   getLifeStageKey() 가 키('학생'/'육아' 등)를 반환하고, dream.js 가 params.lifeStage 로 전송한다.
// LIFE_STAGE_PROMPTS 텍스트는 더 이상 클라에 두지 않는다(서버 격리).
export function getLifeStageKey() {
  const ctx = getUserContext();
  return ctx.lifeStage || '';
}

window.showContextQuestions = showContextQuestions;
