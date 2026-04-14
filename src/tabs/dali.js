// 몽글몽글 — 달이 탭 (고도화)
import { store } from '../store.js';
import { callOpenAI } from '../services/api.js';
import { showToast } from '../components/toast.js';
import { FORTUNES } from '../utils/symbols.js';
import { esc } from '../utils/sanitize.js';
import { logEvent } from '../services/analytics.js';
import { addXPSilent } from './my.js';
import { generatePatternReport } from '../services/dream-pattern.js';
import { canSuggestPremium, markPremiumSuggested } from '../services/subscription.js';
import { detectSuggestionContext, pickSuggestionMessage } from '../utils/dali-premium-prompts.js';

// ── 달이 이해도 ──
function getDaliStats(){
  const tc=parseInt(localStorage.getItem('mg_total_chats')||'0');
  const mem=JSON.parse(localStorage.getItem('mg_dari_memory')||'[]');
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  return {chats:tc, memories:mem.length, dreams:logs.length};
}

// ── 유틸 ──
function getDreamLogs(){ return JSON.parse(localStorage.getItem('mg_logs')||'[]'); }
function getDariMemory(){ return JSON.parse(localStorage.getItem('mg_dari_memory')||'[]'); }
function getJoinDays(){ return Math.max(1,Math.floor((Date.now()-parseInt(localStorage.getItem('mg_join_date')||Date.now()))/(1000*60*60*24))+1); }
function getTimeContext(){
  const h=new Date().getHours();
  if(h>=5&&h<9) return {period:'morning', greeting:'좋은 아침이에요!', prompt:'어젯밤 꿈이 기억나요?'};
  if(h>=9&&h<17) return {period:'daytime', greeting:'안녕하세요!', prompt:'오늘 하루는 어때요?'};
  if(h>=17&&h<21) return {period:'evening', greeting:'수고한 하루였죠.', prompt:'오늘 하루 어땠어요?'};
  return {period:'night', greeting:'이 밤에 찾아줬네요.', prompt:'잠이 안 오나요?'};
}

// ── 꿈 데이터 분석 (강화) ──
function analyzeDreamData(){
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

  // 최근 vs 이전 감정 비교
  const recentEmo=recent.map(l=>l.emotion||'').filter(Boolean);
  const prevEmo=prevWeek.map(l=>l.emotion||'').filter(Boolean);
  const emotionTrend=getEmotionTrend(recentEmo,prevEmo);

  // 길흉 비율
  const good=logs.filter(l=>(l.badges||[]).includes('길몽')).length;
  const bad=logs.filter(l=>(l.badges||[]).includes('흉몽')).length;

  // 꿈 빈도
  const avgPerWeek=logs.length>0?Math.round(recent.length*10)/10:0;

  // 연속 비슷한 꿈 감지
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

function getEmotionTrend(recent,prev){
  if(recent.length===0||prev.length===0) return null;
  const neg=['불안','공포','슬픔','분노','혼란'];
  const rNeg=recent.filter(e=>neg.includes(e)).length/recent.length;
  const pNeg=prev.filter(e=>neg.includes(e)).length/prev.length;
  if(rNeg<pNeg-0.2) return 'improving';
  if(rNeg>pNeg+0.2) return 'worsening';
  return 'stable';
}

function findStreakSymbol(recent){
  if(recent.length<2) return null;
  const allKw=recent.map(l=>[...(l.keywords||[]),...(l.badges||[])]);
  for(const kw of (allKw[0]||[])){
    if(allKw.slice(1,3).every(kws=>kws.includes(kw))) return kw;
  }
  return null;
}

// ── 인사이트 패널 ──
export function toggleDaliInsight(){
  const panel=document.getElementById('daliInsightPanel');
  const btn=document.getElementById('daliInsightBtn');
  if(!panel)return;
  const show=panel.style.display==='none';
  panel.style.display=show?'block':'none';
  btn.classList.toggle('active',show);
  if(show){
    renderInsightPanel();
    logEvent('dali_insight_opened');
  }
}

function renderInsightPanel(){
  const el=document.getElementById('daliInsightGrid');
  if(!el)return;
  const analysis=analyzeDreamData();

  if(!analysis||analysis.total===0){
    el.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted);font-size:12px">
      꿈을 3개 이상 기록하면 패턴 분석이 시작돼요!<br>달이한테 꿈 얘기하면 바로 해몽해줘요 🐱
    </div>`;
    return;
  }

  const trendEmoji=analysis.emotionTrend==='improving'?'📈':analysis.emotionTrend==='worsening'?'📉':'➡️';
  const trendText=analysis.emotionTrend==='improving'?'호전 중':analysis.emotionTrend==='worsening'?'주의 필요':'안정';
  const topEmo=Object.entries(analysis.emotions).sort((a,b)=>b[1]-a[1])[0];
  const topRepeat=analysis.repeats[0];

  el.innerHTML=`
    <div class="dali-insight-card" onclick="daliChipClick('이번 주 내 꿈을 분석해줘','pattern')">
      <div class="dali-ic-emoji">🌙</div>
      <div class="dali-ic-label">이번 주 꿈</div>
      <div class="dali-ic-value">${analysis.recent}개</div>
      <div class="dali-ic-sub">총 ${analysis.total}개 기록</div>
    </div>
    <div class="dali-insight-card" onclick="daliChipClick('요즘 내 감정 흐름을 분석해줘','emotion')">
      <div class="dali-ic-emoji">${trendEmoji}</div>
      <div class="dali-ic-label">감정 흐름</div>
      <div class="dali-ic-value">${topEmo?topEmo[0]:'미파악'}</div>
      <div class="dali-ic-sub">${trendText}</div>
    </div>
    <div class="dali-insight-card" onclick="daliChipClick('내 꿈에서 반복되는 패턴을 알려줘','pattern')">
      <div class="dali-ic-emoji">🔁</div>
      <div class="dali-ic-label">반복 키워드</div>
      <div class="dali-ic-value">${topRepeat?topRepeat[0]:'없음'}</div>
      <div class="dali-ic-sub">${topRepeat?topRepeat[1]+'회 등장':'꿈이 쌓이면 분석'}</div>
    </div>
    <div class="dali-insight-card" onclick="daliChipClick('길몽 비율이 어때?','pattern')">
      <div class="dali-ic-emoji">${analysis.goodRatio>=50?'☀️':'🌧️'}</div>
      <div class="dali-ic-label">길몽 비율</div>
      <div class="dali-ic-value">${analysis.goodRatio}%</div>
      <div class="dali-ic-sub">흉몽 ${analysis.badRatio}%</div>
    </div>
  `;

  // 패턴 엔진 인사이트 추가
  const logs=getDreamLogs();
  const report=generatePatternReport(logs);
  if(report&&report.prediction){
    const stateEmoji={평온:'😌',불안:'😰',공포:'😱',기쁨:'😊',슬픔:'😢'};
    const pred=report.prediction;
    let extraHTML=`
    <div class="dali-insight-card" onclick="daliChipClick('오늘 밤 어떤 꿈을 꿀 것 같아?','pattern')" style="grid-column:1/-1;background:linear-gradient(135deg,rgba(124,92,191,.15),rgba(166,124,239,.08))">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="dali-ic-emoji" style="font-size:22px">${stateEmoji[pred.predicted]||'🔮'}</div>
        <div>
          <div class="dali-ic-label">다음 꿈 예측</div>
          <div class="dali-ic-value">${pred.predicted} (${pred.probability}%)</div>
          <div class="dali-ic-sub">현재 ${stateEmoji[pred.current]||''} ${pred.current} 상태</div>
        </div>
      </div>
    </div>`;
    if(report.clusters.length>0){
      const c=report.clusters[0];
      extraHTML+=`
      <div class="dali-insight-card" onclick="daliChipClick('${c.keyword}이(가) 반복되는 이유가 뭐야?','pattern')" style="grid-column:1/-1">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="dali-ic-emoji" style="font-size:22px">🔄</div>
          <div>
            <div class="dali-ic-label">반복꿈 감지</div>
            <div class="dali-ic-value">"${esc(c.keyword)}" ${c.count}회 반복</div>
            <div class="dali-ic-sub">평균 ${c.avgInterval}일 간격${c.daysUntil>0?' · 약 '+c.daysUntil+'일 후 재발 예상':''}</div>
          </div>
        </div>
      </div>`;
    }
    el.innerHTML+=extraHTML;
  }

  // 달이 기억 관리 UI
  const mem=getDariMemory();
  if(mem.length>0){
    const catIcons={사실:'📋',감정:'💭',패턴:'🔄',조언:'💡'};
    let memHTML=`<div class="dali-insight-card" style="grid-column:1/-1">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">🧠</span><span class="dali-ic-label">달이의 기억 (${mem.length}/50)</span></div>
        <button onclick="event.stopPropagation();window._toggleMemList()" style="font-size:10px;color:var(--purple-bright);background:none;border:1px solid rgba(166,124,239,.2);border-radius:8px;padding:2px 8px;cursor:pointer;font-family:inherit">관리</button>
      </div>
      <div id="daliMemList" style="display:none;max-height:200px;overflow-y:auto">
        ${mem.map((m,i)=>{
          const item=typeof m==='string'?{text:m,cat:'사실',date:''}:m;
          return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">
            <span style="font-size:11px">${catIcons[item.cat]||'📋'}</span>
            <span style="flex:1;font-size:11px;color:var(--text-secondary)">${esc(item.text)}</span>
            <span style="font-size:9px;color:var(--text-muted)">${item.date||''}</span>
            <button onclick="event.stopPropagation();window._delDaliMem(${i})" style="font-size:10px;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:2px 4px">✕</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
    el.innerHTML+=memHTML;
  }
}

window._toggleMemList=function(){
  const el=document.getElementById('daliMemList');
  if(el) el.style.display=el.style.display==='none'?'block':'none';
};
window._delDaliMem=function(idx){
  const mem=getDariMemory();
  if(mem[idx]!==undefined){
    mem.splice(idx,1);
    localStorage.setItem('mg_dari_memory',JSON.stringify(mem));
    renderInsightPanel();
    showToast('기억을 삭제했어요');
  }
};

// ── 스마트 인사 (시간대 + 로테이션) ──
function pickGreetType(){
  const last=parseInt(localStorage.getItem('mg_dali_greet_type')||'0');
  const analysis=analyzeDreamData();
  if(!analysis||analysis.total===0) return 'coach';

  const order=['pattern','emotion','context','coach'];
  let next=order[(last+1)%order.length];
  if(next==='pattern'&&analysis.repeats.length===0) next='emotion';
  if(next==='emotion'&&Object.keys(analysis.emotions).length===0) next='context';
  localStorage.setItem('mg_dali_greet_type',String(order.indexOf(next)));
  return next;
}

function buildSmartGreet(){
  const type=pickGreetType();
  const analysis=analyzeDreamData();
  const mem=getDariMemory();
  const days=getJoinDays();
  const time=getTimeContext();
  const _fd=Math.floor(Date.now()/(1000*60*60*24));
  const fortune=FORTUNES[_fd%FORTUNES.length];

  logEvent('dali_greet_type',{type,period:time.period});

  if(!analysis||analysis.total===0){
    // 첫 방문 — 여러 말풍선으로 몰입감 연출
    const nick=localStorage.getItem('mg_nickname')||'';
    const nameCall=nick?nick+'! ':'';
    const hour=new Date().getHours();
    let timeMsg,timeTip;
    if(hour>=5&&hour<12){
      timeMsg='좋은 아침이야!';
      timeTip='어젯밤 꿈 기억나? 아침이 제일 생생할 때야. 지금 바로 얘기해줘!';
    }else if(hour>=12&&hour<18){
      timeMsg='안녕!';
      timeTip='어젯밤이나 낮잠에서 꾼 꿈 있어? 기억날 때 바로 얘기해줘!';
    }else if(hour>=18&&hour<22){
      timeMsg='좋은 저녁이야!';
      timeTip='오늘 하루 어땠어? 어젯밤 꿈이 아직 기억나면 얘기해줘!';
    }else{
      timeMsg='아직 안 잤어?';
      timeTip='잠들기 전에 어젯밤 꿈 얘기 나눠볼까? 아니면 편하게 대화해도 돼!';
    }
    // 첫 번째 말풍선 즉시, 나머지는 딜레이로 추가
    return {type:'coach', html:`${timeMsg} ${nameCall}나는 <b>달이</b>야 🐱<br>네 꿈을 듣고 해석해주는 꿈 친구야!<br><br>${timeTip}<br><span style="font-size:11px;color:var(--text-muted)">"뱀이 나왔어" "높은 곳에서 떨어졌어" 이런 식으로 편하게 말해줘!</span>`, followups:['어젯밤 꿈 꿨어','꿈을 잘 기억하는 법 알려줘','달이 넌 뭘 해줄 수 있어?']};
  }

  const last=analysis.lastDream;

  if(type==='pattern'){
    const top3=analysis.repeats.slice(0,3);
    const repeatTxt=top3.map(([k,c])=>`<b>${k}</b>(${c}회)`).join(', ');
    let streakAlert='';
    if(analysis.streakSymbol){
      streakAlert=`<div class="dali-rich-card"><div class="dali-rich-title">🔥 연속 패턴 감지</div><div style="font-size:12px;color:var(--text-primary)"><b>${analysis.streakSymbol}</b>이(가) 최근 꿈에서 연속 등장하고 있어요</div></div>`;
    }
    return {type, html:`📊 ${time.greeting} ${days}일간의 꿈을 살펴봤어요.<br><br>자주 등장하는 키워드: ${repeatTxt||'아직 부족해요'}<br>길몽 <b>${analysis.goodRatio}%</b> · 흉몽 <b>${analysis.badRatio}%</b>${streakAlert}`,
      followups:['이 패턴이 무슨 뜻이야?','반복꿈을 안 꾸려면?','길몽 비율 높이는 법']};
  }

  if(type==='emotion'){
    const emos=Object.entries(analysis.emotions).sort((a,b)=>b[1]-a[1]);
    const mainEmo=emos[0];
    let trendCard='';
    if(analysis.emotionTrend){
      const tMap={improving:{emoji:'📈',text:'지난주보다 긍정적인 꿈이 늘었어요!',color:'var(--teal)'},worsening:{emoji:'📉',text:'최근 무거운 감정의 꿈이 늘고 있어요.',color:'var(--pink)'},stable:{emoji:'➡️',text:'감정 흐름이 안정적이에요.',color:'var(--text-secondary)'}};
      const t=tMap[analysis.emotionTrend];
      trendCard=`<div class="dali-rich-card"><div class="dali-rich-title">${t.emoji} 감정 트렌드</div><div style="font-size:12px;color:${t.color}">${t.text}</div></div>`;
    }
    return {type, html:`💜 ${time.greeting} 최근 꿈들의 감정이에요.<br><br>${emos.slice(0,4).map(([e,c])=>`${e} ${c}회`).join(' · ')}${trendCard}`,
      followups:mainEmo?[`${mainEmo[0]} 감정이 왜 많을까?`,'감정 균형 맞추는 법','꿈으로 스트레스 해소하는 법']:[]};
  }

  if(type==='context'){
    const lastTitle=last?last.title:'최근 꿈';
    let memCard='';
    if(mem.length>0){
      const recentMem=mem.slice(-2).map(m=>m.replace('- ','').replace(/\(.+\)/,'').trim());
      memCard=`<div class="dali-rich-card"><div class="dali-rich-title">🧠 달이가 기억하는 것</div>${recentMem.map(m=>`<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">· ${m}</div>`).join('')}</div>`;
    }
    return {type, html:`🔗 ${time.greeting}<br><br>저번에 <b>${lastTitle}</b> 꿈 해몽했었죠?<br>${(last.badges||[]).includes('길몽')?'좋은 기운이 이어지고 있을 거예요!':'그 꿈 이후로 현실에서 뭔가 달라진 게 있었어요?'}${memCard}`,
      followups:['그 꿈에 대해 더 얘기할래','요즘 다른 고민이 생겼어','꿈과 현실이 연결된 느낌이야']};
  }

  // coach
  const tips=[
    {tip:'잠들기 직전에 "오늘 꿈을 기억하겠다"고 3번 되뇌어보세요.',why:'의도를 세우면 기억 확률이 50% 올라간다는 연구가 있어요'},
    {tip:'깨자마자 바로 움직이지 말고, 눈 감은 채 꿈을 떠올려보세요.',why:'30초만 투자하면 꿈 기억이 훨씬 선명해져요'},
    {tip:'자기 전 화면 대신 종이 일기를 써보세요.',why:'블루라이트가 줄면 REM 수면이 깊어져서 꿈이 생생해져요'},
    {tip:`${analysis.total}개째 꿈 기록 중이에요! 꾸준히 하면 자각몽 확률이 올라간대요.`,why:'2주 이상 매일 기록하면 자각몽 경험률이 3배'},
    {tip:'잠들기 2시간 전부터 카페인을 피해보세요.',why:'카페인이 REM 수면을 억제해서 꿈을 잘 못 꾸게 해요'},
  ];
  const t=tips[_fd%tips.length];
  return {type:'coach', html:`🌿 ${time.greeting} 오늘의 꿈 코칭!<br><br><b>${t.tip}</b><br><span style="font-size:11px;color:var(--text-muted)">${t.why}</span><br><br>오늘 운세: "${fortune.title}" ${fortune.emoji}`,
    followups:['자각몽 꾸는 법 알려줘','수면 질 높이는 루틴','악몽 줄이는 방법']};
}

// ── 후속 질문 버튼 ──
function showFollowups(questions){
  const el=document.getElementById('daliFollowup');
  if(!el||!questions||questions.length===0){if(el)el.style.display='none';return;}
  el.style.display='flex';
  el.innerHTML=questions.map(q=>{
    if(q==='🔮 해몽하러 가기') return `<button class="dali-fu-btn" onclick="switchTab('dream');this.parentElement.style.display='none'">${q}</button>`;
    return `<button class="dali-fu-btn" onclick="daliFollowupClick(this,'${q.replace(/'/g,"\\'")}')">${q}</button>`;
  }).join('');
}

export function daliFollowupClick(btn,msg){
  logEvent('dali_followup_click',{msg:msg.substring(0,30)});
  btn.parentElement.style.display='none';
  const inp=document.getElementById('chatIn');
  inp.value=msg;
  sendChat();
}

// ── 퀵 칩 (시간대 반영) ──
export function renderDaliChips(){
  const el=document.getElementById('daliChips');
  if(!el)return;
  const analysis=analyzeDreamData();
  const time=getTimeContext();
  const chips=[];

  // 시간대별 메인 칩
  if(time.period==='morning'){
    chips.push({text:'🌅 어젯밤 꿈 얘기할래',msg:'어젯밤에 꿈을 꿨는데 얘기할래',role:'context'});
  }else if(time.period==='night'){
    chips.push({text:'🌙 잠이 안 와',msg:'잠이 잘 안 오는데 도와줘',role:'coach'});
  }

  if(analysis&&analysis.total>0){
    chips.push({text:'📊 내 꿈 패턴',msg:'내 꿈 기록을 분석해서 패턴과 의미를 알려줘',role:'pattern'});
    chips.push({text:'💜 감정 흐름',msg:'최근 꿈들의 감정 변화를 분석해줘',role:'emotion'});
    if(analysis.lastDream){
      chips.push({text:'🔗 꿈-현실 연결',msg:'최근 꿈이 현실과 어떻게 연결되는지 분석해줘',role:'context'});
    }
    if(analysis.streakSymbol){
      chips.push({text:`🔥 ${analysis.streakSymbol} 반복`,msg:`최근 ${analysis.streakSymbol}이(가) 계속 나오는데 왜 그런 거야?`,role:'pattern'});
    }
  }

  // 꿈 예측
  const prediction=generateDreamPrediction();
  if(prediction){
    chips.push({text:'🔮 오늘 밤 꿈 예측',msg:'오늘 밤 어떤 꿈을 꿀 것 같아?',role:'pattern'});
  }

  chips.push({text:'🌿 꿈 기억하는 법',msg:'꿈을 더 잘 기억하려면 어떻게 해야 해?',role:'coach'});
  chips.push({text:'💭 고민 있어',msg:'요즘 고민이 있어요',role:'context'});

  // 밤에만 수면 모드
  if(time.period==='night'||time.period==='evening'){
    chips.push({text:'😴 잠들기 모드',msg:'__sleep_mode__',role:'sleep'});
  }

  // 아침 의도 체크
  const intention=checkDreamIntention();
  if(intention&&time.period==='morning'){
    chips.push({text:'🌅 어젯밤 의도 확인',msg:`어젯밤 "${intention}" 의도로 잤는데 꿈이 기억나`,role:'context'});
  }

  el.innerHTML=chips.map(c=>{
    if(c.role==='sleep') return `<button class="qbtn" style="background:rgba(125,232,216,.08);border-color:rgba(125,232,216,.2);color:var(--teal)" onclick="startSleepMode()">${c.text}</button>`;
    return `<button class="qbtn" onclick="daliChipClick('${c.msg.replace(/'/g,"\\'")}','${c.role}')">${c.text}</button>`;
  }).join('');
}

export function daliChipClick(msg,role){
  logEvent('dali_chip_click',{role,msg:msg.substring(0,30)});
  document.getElementById('daliFollowup').style.display='none';
  const inp=document.getElementById('chatIn');
  inp.value=msg;
  sendChat();
}

// ── 시스템 프롬프트 ──
export function buildDariContext(){
  const logs=getDreamLogs();
  const mem=getDariMemory();
  const joinDays=getJoinDays();
  const analysis=analyzeDreamData();
  const time=getTimeContext();
  const stats=getDaliStats();

  let context=`너는 "달이"야. 꿈 얘기 듣는 걸 좋아하는 친구.
${time.greeting} ${time.period==='morning'?'아침이니까 어젯밤 꿈 얘기 들을 준비됐어!':time.period==='night'?'밤이니까 차분하게 얘기하자.':''}

너의 성격:
- 따뜻하고 호기심 많은 친구. 전문가 티 내지 마.
- 굵은 글씨(**) 절대 쓰지 마. 그냥 사람처럼 말해.
- 영어 쓰지 마. 학술 용어 쓰지 마. "원형", "무의식", "투영" 이런 말 대신 쉬운 말 써.
- 이모지는 문장 끝에 가끔만. 도배하지 마.
- 친구한테 카톡 보내듯이 편하게 말해.

꿈 얘기 들으면:
- 바로 해석해줘. "해몽 탭에서 해봐" 이런 말 절대 하지 마.
- 뱀꿈이라도 "물린 건지" "잡은 건지"에 따라 완전 다르게 해석해.
- 그 사람이 요즘 뭘 고민하는지에 따라 해석이 달라져. 기억하고 있는 정보 활용해.
- 과거 꿈이랑 연결해서 패턴 알려줘.
- 해몽 후 [해몽: 제목|길몽 or 흉몽|핵심상징] 태그 붙여. (이건 시스템용이라 유저 눈에 안 보여)

꿈 얘기 아닐 때:
- 일상 대화도 OK. 근데 자연스럽게 꿈 얘기로 이어가봐.
- 꿈 기억하는 팁 알려줘도 좋아.
- 감정적이면 공감 먼저.
- 유저가 질문 → 꿈 코치
- 유저가 일상 → 맥락 연결자로 꿈과 이어줌
- 응답 끝에 [역할: interpret|pattern|coach|emotion|context] 태그
- 꿈 해몽했으면 [해몽: 제목|길몽/흉몽|핵심상징] 태그
- 새 정보 발견 시 [메모: 내용] 태그 (사실/감정/패턴/조언 자동 분류됨)
- 응답 끝에 [후속: 질문1|질문2|질문3] 태그

이 사람 정보:
- 이름: ${localStorage.getItem('mg_nickname')||'꿈탐험가'}
- 함께한 지 ${joinDays}일째, 연속 ${store.streak}일 기록 중
- 꿈 기록 ${logs.length}개
`;

  if(analysis){
    context+=`
이 사람의 꿈 이력 (대화에 자연스럽게 녹여서 활용해. "저번에 뱀꿈 꿨었잖아" 이런 식으로):
꿈 ${analysis.total}개 기록함. 이번 주 ${analysis.recent}개.
자주 나오는 키워드: ${analysis.repeats.slice(0,5).map(([k,c])=>k).join(', ')||'아직 없음'}
${analysis.streakSymbol?'최근 '+analysis.streakSymbol+'이 계속 나오고 있어 — 반드시 언급해줘':''}
`;
    if(analysis.recentDreams.length>0){
      context+='최근에 꾼 꿈들:\n';
      analysis.recentDreams.forEach((l,i)=>{
        context+=`- "${l.title}" (${l.date}) — ${(l.text||'').substring(0,60)}\n`;
      });
    }
  }

  if(mem.length>0){
    // 새 형식(객체) + 레거시(문자열) 모두 지원
    const cats={사실:[],감정:[],패턴:[],조언:[]};
    mem.forEach(m=>{
      if(typeof m==='string'){cats['사실'].push(m);}
      else{(cats[m.cat]||cats['사실']).push('- '+m.text+' ('+m.date+')');}
    });
    const parts=Object.entries(cats).filter(([,v])=>v.length>0).map(([k,v])=>`[${k}]\n${v.join('\n')}`);
    if(parts.length>0) context+=`\n달이가 기억하고 있는 것 (${mem.length}개):\n${parts.join('\n')}\n`;
  }

  // CRM 맥락 주입
  try{
    const ctxData=JSON.parse(localStorage.getItem('mg_dream_context')||'{}');
    const parts=[];
    if(ctxData.lifeStage)parts.push('이 사람은 지금 '+ctxData.lifeStage);
    if(ctxData.currentStress)parts.push('스트레스: '+ctxData.currentStress);
    if(ctxData.relationshipStatus)parts.push('연애 상태: '+ctxData.relationshipStatus);
    if(ctxData.relatedMemory)parts.push('관련 추억: '+ctxData.relatedMemory);
    if(parts.length>0)context+='\n이 사람에 대해 알고 있는 것 (자연스럽게 활용해):\n'+parts.join('\n')+'\n';
  }catch{}

  if(window._last){
    const d=window._last.data;
    context+=`\n방금 해몽한 꿈: "${d.title}" (${(d.badges||[]).join(', ')})\n`;
  }

  const daliTone=localStorage.getItem('mg_dali_tone')||'friend';
  const toneMap={
    friend:`- ${joinDays>14?'오래된 친구처럼 편하게':joinDays>3?'점점 친해지는 느낌으로':'첫 만남, 조심스럽고 따뜻하게'}\n- 반말+존댓말 믹스, 이모지 자연스럽게`,
    teacher:'- 조금 더 체계적이고 차분한 선생님 톤. 존댓말 위주.\n- "~해요", "~거예요" 등 부드러운 존댓말.\n- 가르쳐주되 권위적이지 않게, 격려하며 설명해.',
    grandma:'- 한국 할머니 말투. "~했구나", "~란다", "~하렴"\n- 따뜻하고 포근한 톤. 경험에서 우러나온 지혜.\n- "우리 손주" 느낌으로 다정하게.',
    poetic:'- 시적이고 서정적인 말투. 문학적 표현 사용.\n- 은유와 비유를 활용. "달빛이 속삭이듯", "꿈의 강물이 흐르는"\n- 짧고 아름다운 문장. 여운을 남기는 마무리.'
  };
  context+=`
【현재 감정】 ${store.selectedEmotions.length>0?store.selectedEmotions.join(', '):'미감지'}

【말투】
${toneMap[daliTone]||toneMap.friend}
- 핵심 3-4문장, 절대 길게 늘어뜨리지 않기
- 꿈 데이터 인용 시 구체적 수치와 날짜 함께`;

  return context;
}

// ── 인사 ──
export function dariProactiveGreet(){
  if(store.dariGreeted)return;
  store.dariGreeted=true;
  logEvent('dali_opened');

  const greet=buildSmartGreet();
  const msgs=document.getElementById('chatMsgs');
  if(!msgs)return;
  const d=document.createElement('div');
  d.className='cbbl ny';
  d.style.animation='bi .3s ease';
  d.innerHTML=greet.html;
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;

  // 역할 태그 표시
  const roleTag=document.getElementById('daliRoleTag');
  if(roleTag){
    const labels={pattern:'패턴 분석',emotion:'감정 추적',context:'맥락 연결',coach:'꿈 코칭'};
    roleTag.textContent=labels[greet.type]||'';
  }

  // 상태 텍스트 — 데이터 기반
  const status=document.getElementById('daliStatus');
  if(status){
    const analysis=analyzeDreamData();
    if(analysis&&analysis.total>0){
      status.textContent=`꿈 ${analysis.total}개 분석 완료 · 대화할수록 정확해져요`;
    }else{
      status.textContent='꿈 얘기해주면 바로 해몽해줄게요';
    }
  }

  showFollowups(greet.followups);
  renderDaliChips();
  updateDariLevel();
  _renderDaliToneUI();
}

// ── 달이 말투 선택 UI (동적 생성) ──
const DALI_TONES=[
  {key:'friend',icon:'👫',label:'친구',desc:'편하고 친근하게'},
  {key:'teacher',icon:'👩‍🏫',label:'선생님',desc:'차분하고 체계적으로'},
  {key:'grandma',icon:'👵',label:'할머니',desc:'따뜻하고 포근하게'},
  {key:'poetic',icon:'🌙',label:'시적',desc:'서정적이고 아름답게'},
];
function _renderDaliToneUI(){
  const clearBtn=document.querySelector('[onclick="clearChat()"]');
  if(!clearBtn||document.getElementById('daliToneBtn'))return;
  const btn=document.createElement('button');
  btn.id='daliToneBtn';
  btn.title='달이 말투 선택';
  btn.style.cssText='display:flex;align-items:center;gap:3px;background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:16px;padding:4px 8px;cursor:pointer;font-family:inherit';
  const cur=localStorage.getItem('mg_dali_tone')||'friend';
  const tone=DALI_TONES.find(t=>t.key===cur)||DALI_TONES[0];
  btn.innerHTML=`<span style="font-size:12px">${tone.icon}</span><span style="font-size:10px;color:var(--purple-bright)">${tone.label}</span>`;
  btn.onclick=_showTonePicker;
  clearBtn.parentElement.insertBefore(btn, clearBtn);
}
function _showTonePicker(){
  let pop=document.getElementById('daliTonePop');
  if(pop){pop.remove();return;}
  pop=document.createElement('div');
  pop.id='daliTonePop';
  pop.style.cssText='position:absolute;top:100%;right:8px;z-index:100;background:var(--card);border:1px solid rgba(166,124,239,.3);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:4px;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,.4)';
  const cur=localStorage.getItem('mg_dali_tone')||'friend';
  DALI_TONES.forEach(t=>{
    const opt=document.createElement('button');
    opt.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;border:none;border-radius:8px;cursor:pointer;font-family:inherit;text-align:left;background:'+(t.key===cur?'rgba(166,124,239,.15)':'transparent');
    opt.innerHTML=`<span style="font-size:16px">${t.icon}</span><div><div style="font-size:12px;color:var(--text-primary);font-weight:${t.key===cur?'600':'400'}">${t.label}</div><div style="font-size:10px;color:var(--text-muted)">${t.desc}</div></div>`;
    opt.onclick=()=>{
      localStorage.setItem('mg_dali_tone',t.key);
      pop.remove();
      const btn=document.getElementById('daliToneBtn');
      if(btn)btn.innerHTML=`<span style="font-size:12px">${t.icon}</span><span style="font-size:10px;color:var(--purple-bright)">${t.label}</span>`;
      showToast(`달이 말투: ${t.label} ${t.icon}`);
      logEvent('dali_tone_changed',{tone:t.key});
    };
    pop.appendChild(opt);
  });
  const hd=document.querySelector('.chat-hd');
  if(hd){hd.style.position='relative';hd.appendChild(pop);}
  setTimeout(()=>{document.addEventListener('click',function _close(e){if(!pop.contains(e.target)){pop.remove();document.removeEventListener('click',_close);}},{once:false});},10);
}

// ── 채팅 ──
export async function sendChat(){
  const inp=document.getElementById('chatIn');
  const msg=inp.value.trim();if(!msg)return;
  logEvent('dali_message_sent',{length:msg.length});
  inp.value='';addBubble(msg,'me');
  store.chatHist.push({role:'user',content:msg});
  localStorage.setItem('mg_chat_hist',JSON.stringify(store.chatHist.slice(-20)));

  document.getElementById('daliFollowup').style.display='none';

  const tid=addTypingBubble();
  const thinkTime=800+Math.min(msg.length*30,1500)+Math.random()*500;
  await new Promise(r=>setTimeout(r,thinkTime));

  try{
    const sysPrompt=buildDariContext();
    const data=await callOpenAI('chat',{model:'gpt-4o',messages:[{role:'system',content:sysPrompt},...store.chatHist.slice(-14)],max_tokens:450,temperature:.85});
    let reply=data.choices[0].message.content;

    // [역할: xxx] 추출
    const roleMatch=reply.match(/\[역할:\s*(interpret|pattern|coach|emotion|context)\]/);
    if(roleMatch){
      logEvent('dali_role_used',{role:roleMatch[1]});
      reply=reply.replace(roleMatch[0],'').trim();
      const roleTag=document.getElementById('daliRoleTag');
      if(roleTag){
        const labels={interpret:'대화형 해몽',pattern:'패턴 분석',emotion:'감정 추적',context:'맥락 연결',coach:'꿈 코칭'};
        roleTag.textContent=labels[roleMatch[1]]||'';
      }
    }

    // [해몽: 제목|길몽/흉몽|핵심상징] 추출 → 해몽 카드 + 꿈 기록 저장
    const interpMatch=reply.match(/\[해몽:\s*(.+?)\|(.+?)\|(.+?)\]/);
    if(interpMatch){
      reply=reply.replace(interpMatch[0],'').trim();
      const dreamTitle=interpMatch[1].trim();
      const dreamType=interpMatch[2].trim();
      const dreamSymbol=interpMatch[3].trim();
      logEvent('dali_interpret',{title:dreamTitle,type:dreamType});

      // 꿈 기록에 저장
      const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
      const newLog={
        id:Date.now(),date:new Date().toLocaleDateString('ko-KR'),
        title:dreamTitle, text:msg, emotion:'',
        badges:[dreamType], keywords:[dreamSymbol],
        source:'dali'
      };
      logs.unshift(newLog);
      localStorage.setItem('mg_logs',JSON.stringify(logs));

      // 해몽 카드를 응답 뒤에 붙임
      reply+=`\n<div class="dali-interp-card">
        <div class="dali-interp-header"><span>${dreamType==='길몽'?'☀️':'🌧️'}</span> <b>${dreamTitle}</b></div>
        <div class="dali-interp-badges"><span class="badge ${dreamType==='길몽'?'bl':'bb'}">${dreamType}</span> <span class="badge bl">${dreamSymbol}</span></div>
        <div class="dali-interp-saved">📖 꿈 기록에 저장됐어요</div>
        <div class="dali-dream-img" id="dreamImg${Date.now()}"><div class="dali-img-loading">🎨 꿈을 그려보는 중...</div></div>
      </div>`;

      // 꿈 그림 비동기 생성
      const imgId='dreamImg'+(Date.now()-1);
      setTimeout(()=>generateDreamImage(msg,dreamTitle,imgId),500);
    }

    // [후속: 질문1|질문2|질문3] 추출
    const fuMatch=reply.match(/\[후속:\s*(.+?)\]/);
    if(fuMatch){
      const questions=fuMatch[1].split('|').map(q=>q.trim()).filter(Boolean);
      reply=reply.replace(fuMatch[0],'').trim();
      setTimeout(()=>showFollowups(questions),300);
    }

    // [메모: xxx] 추출 — 카테고리 자동 분류, 최대 50개
    const memoMatch=reply.match(/\[메모:\s*(.+?)\]/);
    if(memoMatch){
      const mem=getDariMemory();
      const content=memoMatch[1];
      const catMap=[
        [/좋아|싫어|취미|관심|선호/,'사실'],
        [/불안|슬프|기쁘|화|우울|스트레스|걱정/,'감정'],
        [/반복|자주|항상|매번|패턴/,'패턴'],
        [/하면.*좋|추천|조언|해보|시도/,'조언']
      ];
      const cat=(catMap.find(([re])=>re.test(content))||[,'사실'])[1];
      mem.push({text:content,cat,date:new Date().toLocaleDateString('ko-KR')});
      localStorage.setItem('mg_dari_memory',JSON.stringify(mem.slice(-50)));
      reply=reply.replace(memoMatch[0],'').trim();
    }

    // 남은 태그 전부 제거 (GPT가 비표준 형식으로 태그를 보낼 경우)
    reply=reply.replace(/\[(역할|해몽|메모|후속|태그)[:\s][^\]]*\]/g,'').trim();

    store.chatHist.push({role:'assistant',content:reply});
    localStorage.setItem('mg_chat_hist',JSON.stringify(store.chatHist.slice(-20)));
    replaceTypingBubble(tid,reply);
  }catch(e){
    const logs=getDreamLogs();
    const lastDream=logs.length>0?logs[0]:null;
    const time=getTimeContext();
    const fallbacks={
      '힘들':'많이 힘드셨겠어요 😢 어떤 부분이 제일 힘드셨어요?',
      '고민':'어떤 고민인지 조금 더 얘기해줄 수 있어요? 천천히 들을게요 🌙',
      '잠':'잠이 안 오는 밤이군요... 눈 감고 심호흡 4초-7초-8초 해보세요 🐱',
      '꿈':'어떤 꿈이었어요? 해몽 탭에서 같이 풀어볼 수도 있어요 🔮',
      '패턴':'꿈 기록이 쌓이면 패턴 분석이 더 정확해져요!',
      '기억':'깨자마자 30초간 눈 감고 떠올려보세요! 🌙',
    };
    let reply;
    const matched=Object.entries(fallbacks).find(([k])=>msg.includes(k));
    if(matched) reply=matched[1];
    else if(lastDream) reply=`${lastDream.title} 꿈 이후로 어떠셨어요? 달이가 궁금했어요 🌙`;
    else reply=`${time.greeting} 달이가 들을게요. 조금 더 얘기해줄 수 있어요? 🌙`;
    replaceTypingBubble(tid,reply);
  }

  addXPSilent(3);
  const tc=parseInt(localStorage.getItem('mg_total_chats')||'0')+1;
  localStorage.setItem('mg_total_chats',String(tc));
  updateDariLevel();

  // ── 달이 프리미엄 추천 (탐색적 어조, 24시간 1회, 프로 제외) ──
  if(tc>=3 && canSuggestPremium()){
    const analysis=analyzeDreamData();
    const lastUser=store.chatHist.filter(m=>m.role==='user').slice(-1)[0]?.content||'';
    const lastAssist=store.chatHist.filter(m=>m.role==='assistant').slice(-1)[0]?.content||'';
    const category=detectSuggestionContext(lastUser,lastAssist,analysis);
    if(category){
      const suggestion=pickSuggestionMessage(category);
      if(suggestion){
        markPremiumSuggested();
        logEvent('dali_premium_suggested',{category,feature:suggestion.feature});
        setTimeout(()=>{
          const msgs=document.getElementById('chatMsgs');
          const card=document.createElement('div');
          card.className='dali-premium-hint';
          card.innerHTML=`<div style="background:linear-gradient(135deg,rgba(166,124,239,.08),rgba(125,232,216,.06));border:1px solid rgba(166,124,239,.15);border-radius:12px;padding:10px 14px;margin:6px 0;cursor:pointer;display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">💡</span>
            <span style="font-size:12px;color:var(--text-secondary);line-height:1.4">${esc(suggestion.message)}</span>
            <span style="font-size:10px;color:var(--purple-bright);white-space:nowrap">자세히 →</span>
          </div>`;
          card.addEventListener('click',()=>{
            logEvent('dali_premium_clicked',{category,feature:suggestion.feature});
            if(typeof showPaywall==='function') showPaywall(suggestion.feature);
            else window.showPaywall?.(suggestion.feature);
          });
          msgs.appendChild(card);
          msgs.scrollTop=msgs.scrollHeight;
        },1500);
      }
    }
  }
}

// ── UI 헬퍼 ──
export function addTypingBubble(){
  const msgs=document.getElementById('chatMsgs');
  const id='typing'+Date.now();
  const d=document.createElement('div');
  d.className='cbbl ny typing-bubble';d.id=id;
  d.innerHTML='<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
  return id;
}

export function replaceTypingBubble(id,text){
  const el=document.getElementById(id);
  if(el){
    el.classList.remove('typing-bubble');
    el.innerHTML=esc(text).replace(/\n/g,'<br>');
    el.style.animation='bi .3s ease';
    document.getElementById('chatMsgs').scrollTop=99999;
  }
}

export function qChat(msg){
  const inp=document.getElementById('chatIn');
  inp.value=msg;
  sendChat();
}

export function addBubble(text,who){
  const msgs=document.getElementById('chatMsgs');
  const id='b'+Date.now();
  const d=document.createElement('div');
  d.className='cbbl '+who;d.id=id;d.textContent=text;
  msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;
  return id;
}

export function updBubble(id,text){
  const el=document.getElementById(id);
  if(el){el.textContent=text;el.style.opacity='1';document.getElementById('chatMsgs').scrollTop=99999;}
}

export function updateDariLevel(){
  // 뱃지 제거됨 — 호출부 호환용으로 빈 함수 유지
}

export function clearChat(){
  if(!confirm('대화 기록을 초기화할까요?'))return;
  store.chatHist=[];localStorage.removeItem('mg_chat_hist');store.dariGreeted=false;
  const msgs=document.getElementById('chatMsgs');
  if(msgs)msgs.innerHTML='';
  document.getElementById('daliFollowup').style.display='none';
  dariProactiveGreet();
  renderDaliChips();
  showToast('대화가 초기화됐어요 🌙');
}

// 이전 대화 복원
export function restoreChatHistory(){
  const msgs=document.getElementById('chatMsgs');
  if(!msgs)return;
  if(store.chatHist.length>0){
    store.chatHist.forEach(m=>{
      const d=document.createElement('div');
      d.className='cbbl '+(m.role==='user'?'me':'ny');
      d.innerHTML=esc(m.content).replace(/\n/g,'<br>');
      msgs.appendChild(d);
    });
    store.dariGreeted=true;
  }else{
    // 이전 대화 없으면 스마트 인사
    dariProactiveGreet();
  }
  renderDaliChips();
}
restoreChatHistory();

// ═══ 꿈 그림 생성 (DALL-E) ═══
async function generateDreamImage(dreamText,dreamTitle,containerId){
  const el=document.getElementById(containerId);
  if(!el)return;
  try{
    logEvent('dream_image_started',{title:dreamTitle});
    const prompt=`Dreamy, ethereal digital illustration of a dream: "${dreamText.substring(0,200)}". Style: soft watercolor, magical night sky with stars, gentle purple and blue tones, whimsical and calming atmosphere. No text, no words.`;
    const data=await callOpenAI('image',{model:'dall-e-3',prompt,n:1,size:'1024x1024',quality:'standard'});
    if(data.data&&data.data[0]&&data.data[0].url){
      el.innerHTML=`<img src="${data.data[0].url}" alt="${dreamTitle}" class="dali-dream-img-result" onclick="window.open(this.src)">
        <div class="dali-img-caption">🎨 달이가 그린 "${dreamTitle}"</div>`;
      logEvent('dream_image_completed',{title:dreamTitle});
    }else{
      el.innerHTML='<div class="dali-img-caption" style="color:var(--text-muted)">🎨 그림을 그리지 못했어요</div>';
    }
  }catch(e){
    el.innerHTML='<div class="dali-img-caption" style="color:var(--text-muted)">🎨 그림 생성 중 오류가 발생했어요</div>';
  }
}

// ═══ 수면 전 모드 ═══
export function startSleepMode(){
  logEvent('sleep_mode_started');
  const msgs=document.getElementById('chatMsgs');
  if(!msgs)return;

  // 의도 설정 메모리에 저장
  const intention=document.getElementById('sleepIntention');
  if(intention&&intention.value.trim()){
    localStorage.setItem('mg_dream_intention',intention.value.trim());
    localStorage.setItem('mg_dream_intention_date',new Date().toDateString());
  }

  const d=document.createElement('div');
  d.className='cbbl ny';
  const prediction=generateDreamPrediction();
  const predictionHtml=prediction?`<div style="font-size:11px;color:var(--purple-bright);margin-bottom:8px;padding:6px 8px;background:rgba(166,124,239,.08);border-radius:8px">🔮 ${prediction}</div>`:'';

  d.innerHTML=`<div class="sleep-mode-card">
    <div class="sleep-mode-title">🌙 잠들기 모드</div>
    ${predictionHtml}
    <div class="sleep-mode-step">편안한 자세로 누워보세요.</div>
    <input class="sleep-intention-input" id="sleepIntention" placeholder="오늘 밤 꿈 의도 (선택) — 예: 바다에서 수영하는 꿈">
    <div class="sleep-breath" id="sleepBreath" style="margin-top:12px">
      <div class="breath-circle" id="breathCircle"></div>
      <div class="breath-text" id="breathText">준비</div>
    </div>
    <button class="sleep-start-btn" onclick="runBreathCycle()">4-7-8 호흡 시작</button>
  </div>`;
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}

// 4-7-8 호흡법
export function runBreathCycle(){
  const circle=document.getElementById('breathCircle');
  const text=document.getElementById('breathText');
  if(!circle||!text)return;

  const phases=[
    {label:'들이쉬세요',dur:4000,scale:1.5},
    {label:'멈추세요',dur:7000,scale:1.5},
    {label:'내쉬세요',dur:8000,scale:1},
  ];

  let cycle=0;
  const maxCycles=3;

  function runPhase(pi){
    if(pi>=phases.length){
      cycle++;
      if(cycle>=maxCycles){
        text.textContent='편안한 밤 되세요 🌙';
        circle.style.transform='scale(1)';
        // 의도 확인
        const intention=localStorage.getItem('mg_dream_intention');
        if(intention){
          setTimeout(()=>{
            const d=document.createElement('div');
            d.className='cbbl ny';
            d.innerHTML=`오늘 밤 꿈 의도: "<b>${intention}</b>"<br>내일 아침에 기억나는지 확인해볼게요 🐱`;
            document.getElementById('chatMsgs').appendChild(d);
            document.getElementById('chatMsgs').scrollTop=99999;
          },1500);
        }
        return;
      }
      runPhase(0);return;
    }
    const p=phases[pi];
    text.textContent=p.label+` (${cycle+1}/${maxCycles})`;
    circle.style.transform=`scale(${p.scale})`;
    circle.style.transition=`transform ${p.dur}ms ease`;
    setTimeout(()=>runPhase(pi+1),p.dur);
  }
  runPhase(0);
}

// 아침 의도 체크
export function checkDreamIntention(){
  const date=localStorage.getItem('mg_dream_intention_date');
  const intention=localStorage.getItem('mg_dream_intention');
  if(!date||!intention) return null;
  const today=new Date().toDateString();
  const yesterday=new Date(Date.now()-86400000).toDateString();
  if(date===yesterday||date===today){
    return intention;
  }
  return null;
}

// ═══ 꿈 예측 ═══
export function generateDreamPrediction(){
  const analysis=analyzeDreamData();
  if(!analysis||analysis.total<3) return null;

  const predictions=[];

  // 감정 기반 예측
  const emos=Object.entries(analysis.emotions).sort((a,b)=>b[1]-a[1]);
  if(emos.length>0){
    const mainEmo=emos[0][0];
    const emoMap={
      '불안':'물에 빠지거나 쫓기는',
      '공포':'어두운 곳이나 괴물이 나오는',
      '기쁨':'하늘을 날거나 꽃이 피는',
      '슬픔':'비가 오거나 이별하는',
      '평화':'자연 속에 있는',
      '분노':'싸움이나 폭발하는',
      '혼란':'미로나 길을 잃는',
      '설렘':'새로운 장소를 탐험하는',
      '해방감':'넓은 바다나 하늘을 나는',
    };
    if(emoMap[mainEmo]) predictions.push(`최근 "${mainEmo}" 감정이 강해서, ${emoMap[mainEmo]} 꿈이 올 수 있어요`);
  }

  // 반복 상징 기반
  if(analysis.streakSymbol){
    predictions.push(`"${analysis.streakSymbol}" 패턴이 이어지고 있어서, 비슷한 상징이 변형되어 나타날 수 있어요`);
  }

  // 길흉 트렌드
  if(analysis.emotionTrend==='improving'){
    predictions.push('감정 흐름이 좋아지고 있어서, 밝은 색감의 꿈을 꿀 확률이 높아요');
  }else if(analysis.emotionTrend==='worsening'){
    predictions.push('마음이 무거운 시기라 강렬한 상징의 꿈이 올 수 있어요. 충분히 쉬세요');
  }

  return predictions.length>0?predictions[Math.floor(Math.random()*predictions.length)]:null;
}

// window 노출
window.buildDariContext = buildDariContext;
window.dariProactiveGreet = dariProactiveGreet;
window.sendChat = sendChat;
window.qChat = qChat;
window.addBubble = addBubble;
window.updateDariLevel = updateDariLevel;
window.clearChat = clearChat;
window.daliChipClick = daliChipClick;
window.renderDaliChips = renderDaliChips;
window.toggleDaliInsight = toggleDaliInsight;
window.daliFollowupClick = daliFollowupClick;
window.startSleepMode = startSleepMode;
window.runBreathCycle = runBreathCycle;
window.generateDreamPrediction = generateDreamPrediction;
