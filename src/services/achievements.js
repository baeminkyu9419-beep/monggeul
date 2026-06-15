// 몽글몽글 — 업적(achievements) 시스템 — my.js 에서 추출(2026-06-16, 동작보존).
// ACHIEVEMENTS 정의 + renderAchievements 렌더/1회성 별가루 지급(중복 방지).
// 의존: addStardust(services/stardust.js) / showToast(components/toast.js) / esc(utils/sanitize.js).
// 전부 단방향(이 모듈 → 의존), my.js 로 역의존 없음 → 순환 無.
import { addStardust } from './stardust.js';
import { showToast } from '../components/toast.js';
import { esc } from '../utils/sanitize.js';

// ── 업적 시스템 ──
const ACHIEVEMENTS=[
  {id:'first',emoji:'🌱',name:'첫 발자국',desc:'첫 번째 꿈을 기록했어요',reward:10,check:l=>l.length>=1},
  {id:'dream3',emoji:'🌿',name:'꿈 새싹',desc:'꿈을 3개 기록했어요',reward:20,check:l=>l.length>=3},
  {id:'dream10',emoji:'🌳',name:'꿈 나무',desc:'꿈을 10개 기록했어요',reward:50,check:l=>l.length>=10},
  {id:'dream30',emoji:'🌲',name:'꿈 숲',desc:'꿈을 30개 기록했어요',reward:100,check:l=>l.length>=30},
  {id:'streak3',emoji:'🔥',name:'3일 연속',desc:'3일 연속 꿈을 기록했어요',reward:30,check:()=>parseInt(localStorage.getItem('mg_streak')||'0')>=3},
  {id:'streak7',emoji:'💎',name:'일주일 연속',desc:'7일 연속 꿈을 기록했어요',reward:70,check:()=>parseInt(localStorage.getItem('mg_streak')||'0')>=7},
  {id:'streak30',emoji:'👑',name:'한 달 연속',desc:'30일 연속 기록! 대단해요',reward:300,check:()=>parseInt(localStorage.getItem('mg_streak')||'0')>=30},
  {id:'good5',emoji:'☀️',name:'길몽 수집가',desc:'길몽을 5번 받았어요',reward:30,check:l=>l.filter(d=>(d.badges||[]).includes('길몽')).length>=5},
  {id:'bad3',emoji:'🌧️',name:'용감한 꿈꾼',desc:'흉몽도 3번이나 마주했어요',reward:30,check:l=>l.filter(d=>(d.badges||[]).includes('흉몽')).length>=3},
  {id:'money3',emoji:'💰',name:'재물꿈 체질',desc:'재물운 꿈을 3번 꿨어요',reward:30,check:l=>l.filter(d=>(d.badges||[]).includes('재물운')).length>=3},
  {id:'love3',emoji:'💕',name:'사랑꿈 체질',desc:'연애운 꿈을 3번 꿨어요',reward:30,check:l=>l.filter(d=>(d.badges||[]).includes('연애운')).length>=3},
  {id:'review3',emoji:'🔮',name:'예언자',desc:'꿈 후기를 3번 남겼어요',reward:40,check:l=>l.filter(d=>d.review).length>=3},
  {id:'share',emoji:'📤',name:'꿈 전파자',desc:'꿈을 공유했어요',reward:20,check:()=>localStorage.getItem('mg_shared')==='1'},
  {id:'dali10',emoji:'🐱',name:'달이 단짝',desc:'달이와 10번 대화했어요',reward:50,check:()=>parseInt(localStorage.getItem('mg_total_chats')||'0')>=10},
  {id:'quiz10',emoji:'🧠',name:'퀴즈 마니아',desc:'퀴즈를 10번 풀었어요',reward:40,check:()=>parseInt(localStorage.getItem('mg_quiz_total')||'0')>=10},
  {id:'quiz50',emoji:'🎯',name:'퀴즈 달인',desc:'퀴즈를 50번 풀었어요',reward:100,check:()=>parseInt(localStorage.getItem('mg_quiz_total')||'0')>=50},
  {id:'sleep7',emoji:'💤',name:'수면 기록자',desc:'수면 체크인 7일 완료',reward:40,check:()=>JSON.parse(localStorage.getItem('mg_sleep_logs')||'[]').length>=7},
  {id:'fortune',emoji:'🌟',name:'운세 확인왕',desc:'오늘의 운세를 10번 확인',reward:30,check:()=>parseInt(localStorage.getItem('mg_fortune_cnt')||'0')>=10},
  {id:'dream50',emoji:'🌌',name:'꿈 은하',desc:'꿈을 50개 기록했어요',reward:200,check:l=>l.length>=50},
  {id:'dream100',emoji:'🏆',name:'꿈 전설',desc:'꿈을 100개 기록했어요!',reward:500,check:l=>l.length>=100},
  {id:'dali50',emoji:'💜',name:'달이 베프',desc:'달이와 50번 대화했어요',reward:100,check:()=>parseInt(localStorage.getItem('mg_total_chats')||'0')>=50},
  {id:'streak14',emoji:'⭐',name:'2주 연속',desc:'14일 연속 꿈을 기록했어요',reward:150,check:()=>parseInt(localStorage.getItem('mg_streak')||'0')>=14},
];

export function renderAchievements(){
  const el=document.getElementById('achievementList');
  if(!el)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream);
  // [2026-05-23] 숨긴 기능(달이/퀴즈/운세) 의존 업적은 영구 잠금이라 목록에서 제외(가역: FEATURES true 면 복원).
  const _ff=(typeof window!=='undefined'&&window.FEATURES)||{dali:true,quiz:true,fortune:true};
  const _hiddenAch=new Set([
    ...(_ff.dali?[]:['dali10','dali50']),
    ...(_ff.quiz?[]:['quiz10','quiz50']),
    ...(_ff.fortune?[]:['fortune']),
  ]);
  const _pool=ACHIEVEMENTS.filter(a=>!_hiddenAch.has(a.id));
  const earned=_pool.filter(a=>a.check(logs));
  const locked=_pool.filter(a=>!a.check(logs));

  // 새로 달성된 업적 → 별가루 지급 (중복 방지)
  const claimed=JSON.parse(localStorage.getItem('mg_achievements_claimed')||'[]');
  earned.forEach(a=>{
    if(!claimed.includes(a.id)){
      claimed.push(a.id);
      addStardust(a.reward,'업적: '+a.name);
      showToast(a.emoji+' 업적 달성! '+a.name+' · +'+a.reward+' 별가루');
    }
  });
  localStorage.setItem('mg_achievements_claimed',JSON.stringify(claimed));

  el.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <span style="font-size:12px;font-weight:700;color:var(--text-primary)">${earned.length}/${_pool.length} 달성</span>
    <span style="font-size:10px;color:var(--text-muted)">${Math.round(earned.length/_pool.length*100)}%</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;">
    ${earned.map(a=>`<div style="text-align:center;padding:8px 4px;background:rgba(248,201,76,.06);border:1px solid rgba(248,201,76,.15);border-radius:12px;">
      <div style="font-size:24px;margin-bottom:2px">${a.emoji}</div>
      <div style="font-size:9px;font-weight:700;color:var(--amber)">${esc(a.name)}</div>
      <div style="font-size:8px;color:var(--amber);opacity:.6">+${a.reward} ✦</div>
    </div>`).join('')}
    ${locked.map(a=>`<div style="text-align:center;padding:8px 4px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:12px;opacity:.4;" title="${esc(a.desc)}">
      <div style="font-size:24px;margin-bottom:2px;filter:grayscale(1)">🔒</div>
      <div style="font-size:9px;color:var(--text-muted)">${esc(a.name)}</div>
      <div style="font-size:8px;color:var(--text-muted)">+${a.reward} ✦</div>
    </div>`).join('')}
  </div>`;
}
