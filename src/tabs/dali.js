// 몽글몽글 — 달이 탭 (고도화)
// 데이터/분석 레이어 + 진입점. 채팅 로직: dali-chat.js, 렌더: dali-ui.js
import { store } from '../store.js';
import { FORTUNES } from '../utils/symbols.js';

// ── 유틸 ──
export function getDreamLogs(){ return JSON.parse(localStorage.getItem('mg_logs')||'[]'); }
export function getDariMemory(){ return JSON.parse(localStorage.getItem('mg_dari_memory')||'[]'); }
export function getJoinDays(){ return Math.max(1,Math.floor((Date.now()-parseInt(localStorage.getItem('mg_join_date')||Date.now()))/(1000*60*60*24))+1); }
export function getDaliStats(){
  const tc=parseInt(localStorage.getItem('mg_total_chats')||'0');
  const mem=JSON.parse(localStorage.getItem('mg_dari_memory')||'[]');
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  return {chats:tc, memories:mem.length, dreams:logs.length};
}
export function getTimeContext(){
  const h=new Date().getHours();
  if(h>=5&&h<9) return {period:'morning', greeting:'좋은 아침이에요!', prompt:'어젯밤 꿈이 기억나요?'};
  if(h>=9&&h<17) return {period:'daytime', greeting:'안녕하세요!', prompt:'오늘 하루는 어때요?'};
  if(h>=17&&h<21) return {period:'evening', greeting:'수고한 하루였죠.', prompt:'오늘 하루 어땠어요?'};
  return {period:'night', greeting:'이 밤에 찾아줬네요.', prompt:'잠이 안 오나요?'};
}

// ── 꿈 데이터 분석 ──
export function analyzeDreamData(){
  const logs=getDreamLogs();
  if(logs.length===0) return null;

  const week=Date.now()-7*24*60*60*1000;
  const twoWeeks=Date.now()-14*24*60*60*1000;
  const recent=logs.filter(l=>new Date(l.date)>=week);
  const prevWeek=logs.filter(l=>{const d=new Date(l.date);return d>=twoWeeks&&d<week;});

  // 반복 키워드
  const kwCount={};
  logs.forEach(l=>{
    (l.keywords||[]).forEach(k=>{kwCount[k]=(kwCount[k]||0)+1;});
    (l.badges||[]).forEach(b=>{kwCount[b]=(kwCount[b]||0)+1;});
  });
  const repeats=Object.entries(kwCount).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]);

  // 감정 트렌드
  const emotions=logs.slice(0,10).map(l=>l.emotion||'').filter(Boolean);
  const emotionCount={};
  emotions.forEach(e=>{emotionCount[e]=(emotionCount[e]||0)+1;});

  const recentEmo=recent.map(l=>l.emotion||'').filter(Boolean);
  const prevEmo=prevWeek.map(l=>l.emotion||'').filter(Boolean);
  const emotionTrend=getEmotionTrend(recentEmo,prevEmo);

  // 길흉 비율
  const good=logs.filter(l=>(l.badges||[]).includes('길몽')).length;
  const bad=logs.filter(l=>(l.badges||[]).includes('흉몽')).length;

  const avgPerWeek=logs.length>0?Math.round(recent.length*10)/10:0;
  const streakSymbol=findStreakSymbol(logs.slice(0,5));

  return {
    total:logs.length, recent:recent.length, prevWeekCount:prevWeek.length,
    repeats, emotions:emotionCount, emotionTrend,
    goodRatio:logs.length>0?Math.round(good/logs.length*100):0,
    badRatio:logs.length>0?Math.round(bad/logs.length*100):0,
    lastDream:logs[0], recentDreams:logs.slice(0,5),
    avgPerWeek, streakSymbol
  };
}

export function getEmotionTrend(recent,prev){
  if(recent.length===0||prev.length===0) return null;
  const neg=['불안','공포','슬픔','분노','혼란'];
  const rNeg=recent.filter(e=>neg.includes(e)).length/recent.length;
  const pNeg=prev.filter(e=>neg.includes(e)).length/prev.length;
  if(rNeg<pNeg-0.2) return 'improving';
  if(rNeg>pNeg+0.2) return 'worsening';
  return 'stable';
}

export function findStreakSymbol(recent){
  if(recent.length<2) return null;
  const allKw=recent.map(l=>[...(l.keywords||[]),...(l.badges||[])]);
  for(const kw of (allKw[0]||[])){
    if(allKw.slice(1,3).every(kws=>kws.includes(kw))) return kw;
  }
  return null;
}

// ── 서브모듈 로드 (사이드이펙트: window 함수 등록) ──
import './dali-chat.js';
import './dali-ui.js';

// 이전 대화 복원 + 인사 진입 — dali-chat.js 로드 후 실행
import { restoreChatHistory } from './dali-chat.js';
restoreChatHistory();
