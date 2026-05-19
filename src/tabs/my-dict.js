// 몽글몽글 — MY 탭 꿈 사전 (Dict) 영역
// my.js 의 Dict 함수 + ALL_DICT 통합 분리.
// 외부 의존: dream.js 가 ALL_DICT_REF 를 my.js 로 import → my.js 에서 re-export 유지.

import { esc } from '../utils/sanitize.js';
import { DICT_DATA } from '../utils/symbols.js';
import { EXTENDED_DICT } from '../utils/dream-data.js';
import { renderEmotionFlowChart } from '../components/emotion-chart.js';
import { renderSymbolTracker } from '../components/symbol-tracker.js';

let dictCategory='전체';
let dictSearch='';

export function openDictPage(){
  document.getElementById('dictPage').classList.add('on');
  document.getElementById('dictSearchInput').value='';
  dictSearch='';dictCategory='전체';
  document.querySelectorAll('.dct-tab').forEach((b,i)=>{b.classList.toggle('on',i===0);});
  renderDict();
}
export function closeDictPage(){document.getElementById('dictPage').classList.remove('on');}

export function setDictCategory(cat,btn){
  dictCategory=cat;
  document.querySelectorAll('.dct-tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderDict();
}

export function filterDict(){
  dictSearch=document.getElementById('dictSearchInput').value.trim();
  renderDict();
}

// 통합 꿈 사전 (기존 + 확장)
export const ALL_DICT_REF = {get:()=>ALL_DICT};
const ALL_DICT = (() => {
  const merged = [...DICT_DATA];
  const existingNames = new Set(DICT_DATA.map(d => d.n));
  EXTENDED_DICT.forEach(d => {
    if (existingNames.has(d.n)) {
      // 같은 이름이면 contexts 합치기
      const existing = merged.find(m => m.n === d.n);
      if (existing) {
        const existingTexts = new Set(existing.contexts.map(c => c.t));
        d.contexts.forEach(c => { if (!existingTexts.has(c.t)) existing.contexts.push(c); });
        if (d.meaning.length > existing.meaning.length) existing.meaning = d.meaning;
      }
    } else {
      merged.push(d);
    }
  });
  return merged;
})();

export function renderDict(){
  const q=dictSearch.toLowerCase();
  let items=ALL_DICT;
  if(dictCategory!=='전체')items=items.filter(d=>d.cat===dictCategory);
  if(q)items=items.filter(d=>d.n.includes(q)||d.e.includes(q)||d.cat.includes(q)||d.meaning.includes(q));

  const el=document.getElementById('dictContent');
  if(!items.length){
    el.innerHTML=`<div class="dict-empty"><div class="dict-empty-icon">🔍</div><div class="dict-empty-text">찾는 상징이 없어요.<br>다른 키워드로 검색해보세요!</div></div>`;
    return;
  }
  el.innerHTML=items.map(d=>{
    const name=esc(d.n);
    return `<div class="dict-item" id="di_${name}" onclick="toggleDictItem('${name}')">
      <div class="di-top">
        <div class="di-emoji">${d.e}</div>
        <div class="di-info">
          <div class="di-name">${name}</div>
          <div class="di-tags">${d.tags.map(t=>`<span class="di-tag ${t==='길몽'||t==='대길'?'di-lucky':t==='주의'?'di-warning':'di-neutral'}">${esc(t)}</span>`).join('')}</div>
        </div>
        <span class="di-arrow">›</span>
      </div>
      <div class="di-body">
        <div class="di-meaning">${esc(d.meaning)}</div>
        ${d.tabs?`<div class="di-sub-title" style="margin-top:8px">✦ 3가지 시선으로 보기</div>
        <div class="di-tabs-wrap">
          <div class="di-tabs-nav"><button class="di-tab-btn active" onclick="event.stopPropagation();this.parentElement.querySelectorAll('.di-tab-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');this.closest('.di-tabs-wrap').querySelectorAll('.di-tab-pane').forEach((p,i)=>p.style.display=i===0?'block':'none')">🏛 전통</button><button class="di-tab-btn" onclick="event.stopPropagation();this.parentElement.querySelectorAll('.di-tab-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');this.closest('.di-tabs-wrap').querySelectorAll('.di-tab-pane').forEach((p,i)=>p.style.display=i===1?'block':'none')">🧠 심리</button><button class="di-tab-btn" onclick="event.stopPropagation();this.parentElement.querySelectorAll('.di-tab-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');this.closest('.di-tabs-wrap').querySelectorAll('.di-tab-pane').forEach((p,i)=>p.style.display=i===2?'block':'none')">🌍 문화</button></div>
          <div class="di-tab-pane" style="display:block">${esc(d.tabs.trad)}</div>
          <div class="di-tab-pane" style="display:none">${esc(d.tabs.psych)}</div>
          <div class="di-tab-pane" style="display:none">${esc(d.tabs.cult)}</div>
        </div>`:''}
        ${d.emotions?`<div class="di-sub-title" style="margin-top:8px">✦ 감정 연관도</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(d.emotions).map(([k,v])=>`<span style="font-size:10px;background:rgba(166,124,239,${v/100*0.3});border:1px solid rgba(166,124,239,.2);border-radius:10px;padding:2px 8px;color:var(--text-secondary)">${k} ${v}%</span>`).join('')}</div>`:''}
        <div class="di-sub-title">✦ 상황별 해석</div>
        <div class="di-context-row">${d.contexts.map(c=>`<div class="di-ctx">${esc(c.t)}</div>`).join('')}</div>
        <div style="margin-top:11px">
          <button class="btn-main" style="font-size:12px;padding:10px" onclick="event.stopPropagation();fillDream('${name}꿈을');switchTab('dream');showToast('${name}꿈으로 해몽할게요! 🔮')">🔮 이 상징으로 해몽하기</button>
        </div>
      </div>
    </div>`;
  }).join('');
  // 5상태 감정 흐름 차트
  // NOTE: 'days' 변수 = my.js 원본에서 미정의 (pre-existing bug, 분리는 동작 변경 X 원칙으로 보존)
  renderEmotionFlowChart('emotionFlowChart', days);
  renderSymbolTracker('symbolTrackerWrap');
}
