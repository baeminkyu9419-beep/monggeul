// 몽글몽글 — 달이 렌더/UI (dali.js에서 분리)
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { esc } from '../utils/sanitize.js';
import { logEvent } from '../services/analytics.js';
import { FORTUNES } from '../utils/symbols.js';
import { generatePatternReport } from '../services/dream-pattern.js';
import { analyzeDreamData, getDreamLogs, getDariMemory, getJoinDays, getTimeContext, getEmotionTrend, findStreakSymbol } from './dali.js';
import { addTypingBubble, replaceTypingBubble } from './dali-chat.js';

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
export function showFollowups(questions){
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
  if(window.sendChat) window.sendChat();
}

// ── 퀵 칩 (시간대 반영) ──
export function renderDaliChips(){
  const el=document.getElementById('daliChips');
  if(!el)return;
  const analysis=analyzeDreamData();
  const time=getTimeContext();
  const chips=[];

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

  const prediction=generateDreamPrediction();
  if(prediction){
    chips.push({text:'🔮 오늘 밤 꿈 예측',msg:'오늘 밤 어떤 꿈을 꿀 것 같아?',role:'pattern'});
  }

  chips.push({text:'🌿 꿈 기억하는 법',msg:'꿈을 더 잘 기억하려면 어떻게 해야 해?',role:'coach'});
  chips.push({text:'💭 고민 있어',msg:'요즘 고민이 있어요',role:'context'});

  if(time.period==='night'||time.period==='evening'){
    chips.push({text:'😴 잠들기 모드',msg:'__sleep_mode__',role:'sleep'});
  }

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
  if(window.sendChat) window.sendChat();
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

  const roleTag=document.getElementById('daliRoleTag');
  if(roleTag){
    const labels={pattern:'패턴 분석',emotion:'감정 추적',context:'맥락 연결',coach:'꿈 코칭'};
    roleTag.textContent=labels[greet.type]||'';
  }

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
  if(window.updateDariLevel) window.updateDariLevel();
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

// ═══ 수면 전 모드 ═══
export function startSleepMode(){
  logEvent('sleep_mode_started');
  const msgs=document.getElementById('chatMsgs');
  if(!msgs)return;

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
        const intention=localStorage.getItem('mg_dream_intention');
        if(intention){
          setTimeout(()=>{
            const d=document.createElement('div');
            d.className='cbbl ny';
            d.innerHTML=`오늘 밤 꿈 의도: "<b>${esc(intention)}</b>"<br>내일 아침에 기억나는지 확인해볼게요 🐱`;
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

  if(analysis.streakSymbol){
    predictions.push(`"${analysis.streakSymbol}" 패턴이 이어지고 있어서, 비슷한 상징이 변형되어 나타날 수 있어요`);
  }

  if(analysis.emotionTrend==='improving'){
    predictions.push('감정 흐름이 좋아지고 있어서, 밝은 색감의 꿈을 꿀 확률이 높아요');
  }else if(analysis.emotionTrend==='worsening'){
    predictions.push('마음이 무거운 시기라 강렬한 상징의 꿈이 올 수 있어요. 충분히 쉬세요');
  }

  return predictions.length>0?predictions[Math.floor(Math.random()*predictions.length)]:null;
}

// window 노출
window.dariProactiveGreet = dariProactiveGreet;
window.renderDaliChips = renderDaliChips;
window.toggleDaliInsight = toggleDaliInsight;
window.daliFollowupClick = daliFollowupClick;
window.daliChipClick = daliChipClick;
window.startSleepMode = startSleepMode;
window.runBreathCycle = runBreathCycle;
window.generateDreamPrediction = generateDreamPrediction;
window.showFollowups = showFollowups;
