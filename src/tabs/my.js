import { renderNotifSettings } from '../services/notification-scheduler.js';
// 몽글몽글 — MY 탭
import { store } from '../store.js';
import { showToast } from '../components/toast.js';
import { showPaywall, showUnconsciousPaywall } from '../components/paywall.js';
import { getUserTier } from '../services/subscription.js';
import { esc, sanitize } from '../utils/sanitize.js';
import { DICT_DATA, FORTUNES, QUIZ_DATA, REPORT_DATA, FLOW_DEMO } from '../utils/symbols.js';
import { EXTENDED_DICT } from '../utils/dream-data.js';
import { logEvent } from '../services/analytics.js';
import { trackFunnelStep } from '../utils/funnel.js';
import { drawDualRadar } from '../components/radar.js';
import { generatePatternReport } from '../services/dream-pattern.js';
import { renderEmotionFlowChart } from '../components/emotion-chart.js';
import { renderSymbolTracker } from '../components/symbol-tracker.js';
import { showSleepCheckin, showMorningCheckin, renderSleepCorrelation } from '../components/sleep-checkin.js';
import { showExportModal } from '../components/dream-export.js';
import { openMonthlyReport, generateGPTNarrative, shareReportImage } from './my-monthly-report.js';
import { openFlowPage, closeFlowPage, setFlowPeriod, renderFlow } from './my-flow.js';
import { openDictPage, closeDictPage, setDictCategory, filterDict, renderDict, ALL_DICT_REF } from './my-dict.js';
export { ALL_DICT_REF };
import { renderEmotionFlow, renderRecurringTimeline, renderSymbolEvolution, renderSleepCheckin, renderSleepDreamCorrelation } from './my-emotion-sleep.js';

let calYear=new Date().getFullYear(),calMonth=new Date().getMonth();
let reportWeekOffset = 0;
let quizState={idx:0,correct:0,todayDone:false,answered:false};

// ── 꿈 타임라인 (최근 30일) ──
export function renderDreamTimeline(){
  const container=document.getElementById('dreamPatternCard');
  if(!container)return;
  let tl=document.getElementById('dreamTimeline');
  if(!tl){
    tl=document.createElement('div');
    tl.id='dreamTimeline';
    tl.style.cssText='margin-bottom:14px';
    container.parentElement.insertBefore(tl,container);
  }
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream);
  if(logs.length<2){tl.style.display='none';return;}
  tl.style.display='block';
  const today=new Date();today.setHours(0,0,0,0);
  const days=[];
  for(let i=29;i>=0;i--){
    const d=new Date(today);d.setDate(d.getDate()-i);
    const dateStr=d.getFullYear()+'. '+(d.getMonth()+1)+'. '+d.getDate()+'.';
    const dream=logs.find(l=>l.date===dateStr);
    days.push({date:d,dateStr,dream,dom:d.getDate()});
  }
  const eEmoji={길몽:'😊',흉몽:'😰',태몽:'🤰',재물운:'💰',연애운:'💕',건강운:'💪'};
  const eColor={길몽:'var(--teal)',흉몽:'var(--pink)',태몽:'var(--moon)',재물운:'var(--amber)',연애운:'var(--pink)',건강운:'var(--teal)'};
  const cnt=days.filter(d=>d.dream).length;
  tl.innerHTML='<div class="sec-title" style="display:flex;justify-content:space-between;align-items:center"><span>최근 30일 꿈 타임라인</span><span style="font-size:10px;color:var(--text-muted)">'+cnt+'일 기록</span></div><div class="card" style="padding:12px 8px;overflow-x:auto;-webkit-overflow-scrolling:touch"><div style="display:flex;gap:3px;min-width:'+days.length*22+'px;align-items:flex-end;height:80px">'+days.map(d=>{
    if(!d.dream) return '<div style="display:flex;flex-direction:column;align-items:center;flex:0 0 18px;height:100%;justify-content:flex-end"><div style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.08);margin-bottom:2px"></div><div style="font-size:7px;color:var(--text-muted);opacity:.4">'+d.dom+'</div></div>';
    const badge=(d.dream.badges||[])[0]||'';
    const color=eColor[badge]||'var(--purple-bright)';
    const emoji=eEmoji[badge]||'🌙';
    const barH=Math.max(20,Math.min(60,(d.dream.stats?.길흉||50)*0.6));
    return '<div style="display:flex;flex-direction:column;align-items:center;flex:0 0 18px;height:100%;justify-content:flex-end;cursor:pointer" onclick="showToast(this.dataset.tip)" data-tip="꿈 기록"><div style="font-size:10px;margin-bottom:2px">'+emoji+'</div><div style="width:10px;height:'+barH+'px;border-radius:5px;background:'+color+';opacity:.7"></div><div style="font-size:7px;color:var(--text-secondary);margin-top:2px;font-weight:600">'+d.dom+'</div></div>';
  }).join('')+'</div></div>';
}
window.renderDreamTimeline=renderDreamTimeline;

export function searchDreamLog(){
  const q=(document.getElementById('dreamSearchInput')?.value||'').trim().toLowerCase();
  if(!q){renderLog();return;}
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const filtered=logs.filter(l=>(l.text&&l.text.toLowerCase().includes(q))||(l.title&&l.title.toLowerCase().includes(q)));
  const el=document.getElementById('logList');
  if(!el)return;
  if(!filtered.length){el.innerHTML='<div class="empty"><div class="empty-icon">🔍</div><div class="empty-txt">"'+esc(q)+'" 관련 꿈이 없어요</div></div>';return;}
  const bm={길몽:'bl',태몽:'bl',재물운:'bl',흉몽:'bb',연애운:'bv',건강운:'bv'};
  el.innerHTML=filtered.map(l=>'<div class="log-item"><div class="log-hd"><span class="log-dt">'+esc(l.date||'')+'</span><div class="log-bgs">'+(l.badges||[]).map(b=>'<span class="badge '+(bm[b]||'bl')+'" style="font-size:10px;padding:2px 7px">'+esc(b)+'</span>').join('')+'</div></div><div class="log-txt">'+esc(l.text||'')+'</div><div class="log-ttl">✦ '+esc(l.title||'')+'</div></div>').join('');
}

export function resetAllData(){
  if(!confirm('모든 데이터가 삭제됩니다.\n(꿈 기록, 냥이, 재화 전부)\n\n정말 초기화하시겠어요?'))return;
  if(!confirm('마지막 확인: 되돌릴 수 없습니다!'))return;
  Object.keys(localStorage).filter(k=>k.startsWith('mg_')).forEach(k=>localStorage.removeItem(k));
  showToast('데이터가 초기화됐어요. 새로고침합니다...');
  setTimeout(()=>location.reload(),1500);
}

export function editNickname(){
  const cur=localStorage.getItem('mg_nickname')||'꿈탐험가';
  const name=prompt('새 닉네임을 입력하세요:',cur);
  if(name&&name.trim()){
    localStorage.setItem('mg_nickname',name.trim().substring(0,10));
    document.getElementById('myNickname').textContent=name.trim().substring(0,10);
    showToast('닉네임이 변경됐어요! ✨');
  }
}

export function exportDreamLog(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(!logs.length){showToast('내보낼 꿈 기록이 없어요');return;}
  let text='📖 몽글몽글 꿈 일기장\n═══════════════════\n\n';
  logs.forEach(l=>{
    text+=`📅 ${l.date}\n`;
    text+=`🌙 ${l.title}\n`;
    text+=`${l.text}\n`;
    if(l.badges)text+=`배지: ${l.badges.join(', ')}\n`;
    if(l.review)text+=`후기: ${l.review}\n`;
    text+='\n───────────────────\n\n';
  });
  text+='— 몽글몽글 꿈 해몽 앱에서 내보냄 🌙\n';
  if(navigator.share){
    navigator.share({title:'몽글몽글 꿈 일기장',text});
  }else{
    const blob=new Blob([text],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='monggeul_dreams.txt';a.click();
    URL.revokeObjectURL(url);
    showToast('꿈 기록이 다운로드됐어요 📤');
  }
}

// 꿈 요약 이미지 카드 (인스타 스토리용)
export async function exportDreamImage(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream);
  if(logs.length<3){showToast('꿈이 3개 이상 있어야 이미지를 만들 수 있어요');return;}

  const report=generatePatternReport(logs);
  const c=document.createElement('canvas');c.width=1080;c.height=1920;
  const ctx=c.getContext('2d');
  const W=1080,H=1920;

  // 배경
  const bg=ctx.createLinearGradient(0,0,W*.3,H);
  bg.addColorStop(0,'#08061a');bg.addColorStop(.4,'#150e35');bg.addColorStop(1,'#0a0d20');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

  // 별
  for(let i=0;i<60;i++){
    const x=Math.random()*W,y=Math.random()*H*.6,r=Math.random()*2+.5;
    ctx.fillStyle=`rgba(255,255,240,${.2+Math.random()*.4})`;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  }

  // 제목
  ctx.fillStyle='#f5e6b2';ctx.font='bold 52px sans-serif';ctx.textAlign='center';
  ctx.shadowColor='rgba(245,230,178,.3)';ctx.shadowBlur=15;
  ctx.fillText('나의 꿈 프로필',W/2,160);ctx.shadowBlur=0;

  // 닉네임
  const nick=localStorage.getItem('mg_nickname')||'꿈탐험가';
  ctx.fillStyle='#a89dd0';ctx.font='28px sans-serif';
  ctx.fillText(nick+' · 총 '+logs.length+'개의 꿈',W/2,220);

  // 구분선
  const div=ctx.createLinearGradient(W*.2,0,W*.8,0);
  div.addColorStop(0,'transparent');div.addColorStop(.5,'rgba(166,124,239,.4)');div.addColorStop(1,'transparent');
  ctx.fillStyle=div;ctx.fillRect(W*.2,260,W*.6,1);

  // 최근 5개 꿈 제목
  ctx.textAlign='left';ctx.font='30px sans-serif';ctx.fillStyle='#c8bff8';
  ctx.fillText('최근 꿈',80,330);
  logs.slice(0,5).forEach((l,i)=>{
    ctx.fillStyle='#8a7eb0';ctx.font='24px sans-serif';
    ctx.fillText(l.date||'',80,390+i*56);
    ctx.fillStyle='#e8e0ff';ctx.font='26px sans-serif';
    ctx.fillText((l.title||'').substring(0,25),260,390+i*56);
  });

  // 감정 분포
  if(report){
    const stateEmoji={평온:'😌',불안:'😰',공포:'😱',기쁨:'😊',슬픔:'😢'};
    const stateColor={평온:'#7de8d8',불안:'#f8c94c',공포:'#f0a8c8',기쁨:'#a67cef',슬픔:'#90b0ff'};
    let sy=720;
    ctx.fillStyle='#c8bff8';ctx.font='30px sans-serif';ctx.textAlign='left';
    ctx.fillText('감정 분포',80,sy);sy+=50;

    report.states.forEach(s=>{
      const cnt=report.emotionDist[s]||0;
      const pct=report.totalDreams>0?Math.round(cnt/report.totalDreams*100):0;
      ctx.fillStyle='#6b5e8a';ctx.font='24px sans-serif';ctx.textAlign='left';
      ctx.fillText((stateEmoji[s]||'')+' '+s,80,sy);
      ctx.fillStyle='rgba(255,255,255,.06)';
      ctx.beginPath();ctx.roundRect(240,sy-16,640,22,11);ctx.fill();
      ctx.fillStyle=stateColor[s]||'#a67cef';
      ctx.beginPath();ctx.roundRect(240,sy-16,640*pct/100,22,11);ctx.fill();
      ctx.fillStyle='#f0ecff';ctx.font='bold 22px sans-serif';ctx.textAlign='right';
      ctx.fillText(pct+'%',W-80,sy);
      sy+=50;
    });

    // 예측
    if(report.prediction){
      sy+=20;
      ctx.textAlign='center';ctx.fillStyle='#f5e6b2';ctx.font='bold 32px sans-serif';
      ctx.fillText('다음 꿈 예측: '+(stateEmoji[report.prediction.predicted]||'')+' '+report.prediction.predicted+' ('+report.prediction.probability+'%)',W/2,sy);
    }

    // 반복 키워드
    if(report.clusters.length>0){
      sy+=80;
      ctx.fillStyle='#c8bff8';ctx.font='30px sans-serif';ctx.textAlign='left';
      ctx.fillText('반복 키워드',80,sy);sy+=45;
      report.clusters.slice(0,3).forEach(cl=>{
        ctx.fillStyle='#a89dd0';ctx.font='26px sans-serif';
        ctx.fillText('🔄 '+cl.keyword+' · '+cl.count+'회 · ~'+cl.avgInterval+'일 간격',80,sy);
        sy+=42;
      });
    }
  }

  // 브랜딩
  ctx.fillStyle=div;ctx.fillRect(W*.2,H-180,W*.6,1);
  ctx.fillStyle='rgba(200,191,248,.5)';ctx.font='28px sans-serif';ctx.textAlign='center';
  ctx.fillText('🌙 몽글몽글',W/2,H-130);
  ctx.fillStyle='rgba(200,191,248,.3)';ctx.font='18px sans-serif';
  ctx.fillText('baeminkyu9419-beep.github.io/monggeul',W/2,H-90);

  c.toBlob(blob=>{
    if(!blob)return;
    if(navigator.share&&navigator.canShare){
      const file=new File([blob],'monggeul_profile.png',{type:'image/png'});
      if(navigator.canShare({files:[file]})){
        navigator.share({title:'나의 꿈 프로필',files:[file]});
        logEvent('dream_profile_shared');
        return;
      }
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='monggeul_profile.png';a.click();
    URL.revokeObjectURL(url);
    showToast('꿈 프로필 이미지가 저장됐어요 📤');
    logEvent('dream_profile_exported');
  },'image/png');
}

window.exportDreamImage=exportDreamImage;

export function renderLog(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const el=document.getElementById('logList');
  if(!logs.length){el.innerHTML='<div class="empty"><div class="empty-icon">📖</div><div class="empty-txt">아직 기록된 꿈이 없어요.<br>해몽 후 저장하면 여기에 쌓여요!</div></div>';return;}
  const bm={길몽:'bl',태몽:'bl',재물운:'bl',흉몽:'bb',연애운:'bv',건강운:'bv'};
  const now=Date.now();
  el.innerHTML=logs.map((l,idx)=>{
    const reviewDone=l.review;
    const daysPassed=l.id?(now-l.id)/(1000*60*60*24):999;
    const showReview=(!reviewDone&&daysPassed>=7)||(!reviewDone&&idx===0);
    return`<div class="log-item">
      <div class="log-hd"><span class="log-dt">${esc(l.date)}</span><div class="log-bgs">${(l.badges||[]).map(b=>`<span class="badge ${bm[b]||'bl'}" style="font-size:10px;padding:2px 7px">${esc(b)}</span>`).join('')}</div></div>
      <div class="log-txt">${esc(l.text||'')}</div>
      <div class="log-ttl">✦ ${esc(l.title||'')}</div>
      ${l.emotions&&l.emotions.length?'<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px">'+l.emotions.map(e=>'<span style="font-size:9px;background:rgba(166,124,239,.1);border-radius:8px;padding:1px 6px;color:var(--text-muted)">'+esc(e)+'</span>').join('')+'</div>':''}
      ${reviewDone?`<div style="font-size:11px;color:var(--teal);margin-top:6px">✓ 후기 완료 · ${esc(l.review||'')}</div>`:''}
      <div style="text-align:right;margin-top:6px"><button onclick="event.stopPropagation();deleteDreamLog(${idx})" style="background:none;border:none;font-size:10px;color:var(--text-muted);cursor:pointer;font-family:'Noto Sans KR',sans-serif;opacity:.5">삭제</button></div>
      ${showReview&&!reviewDone?`<div class="review-check">
        <div class="review-check-label">🔮 이 꿈 해석, 실제로 맞았나요?</div>
        <div class="review-btns">
          <button class="review-btn" onclick="submitReview(${idx},'✅ 맞았어요',this)">✅ 맞았어요</button>
          <button class="review-btn" onclick="submitReview(${idx},'🤔 조금요',this)">🤔 조금요</button>
          <button class="review-btn" onclick="submitReview(${idx},'❌ 아니에요',this)">❌ 아니에요</button>
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

export function deleteDreamLog(idx){
  if(!confirm('이 꿈 기록을 삭제할까요?'))return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs[idx]){logs.splice(idx,1);localStorage.setItem('mg_logs',JSON.stringify(logs));}
  renderLog();updateStats();renderCalendar();renderDreamPersonality();renderPatternCard();renderEmotionFlow();renderRecurringTimeline();renderSymbolTracker('symbolTrackerWrap');renderDreamTimeline();renderUnconsciousProfile();renderDreamGallery();
  // 아침 체크인 배너 (오늘 미완료 시 표시)
  const _slLogs=JSON.parse(localStorage.getItem('mg_sleep_logs')||'[]');
  const _today=new Date().toISOString().split('T')[0];
  const _todaySl=_slLogs.find(l=>l.date===_today);
  const _banner=document.getElementById('checkinBanner');
  if(_banner)_banner.style.display=(!_todaySl||!_todaySl.satisfaction)?'block':'none';
  renderSleepCorrelation('sleepCorrelationChart');
  showToast('삭제됐어요');
}

export function submitReview(idx,val,btn){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs[idx]){logs[idx].review=val;localStorage.setItem('mg_logs',JSON.stringify(logs));}
  btn.closest('.review-check').innerHTML=`<div style="font-size:12px;color:var(--teal);text-align:center;padding:4px 0">후기 완료! ${esc(val)} · +5 XP ✨</div>`;
  addXP(5);
}

export function updateStats(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const el=id=>document.getElementById(id);
  // 별가루
  const sdEl=el('stardustCount');if(sdEl)sdEl.textContent=getStardust();
  // 연속 기록
  const stDays=el('stDays');if(stDays)stDays.textContent=store.streak;
  // MY 통계
  const lvNum=el('myLvNum');if(lvNum)lvNum.textContent=logs.filter(l=>!l.noDream).length;
  const streakNum=el('myStreakNum');if(streakNum)streakNum.textContent=store.streak;
  const logCount=el('myLogCount');if(logCount)logCount.textContent=logs.length;
  // 출석 완료 상태
  if(store.lastCin===new Date().toDateString()){const b=el('cinBtn');if(b){b.textContent='완료!';b.classList.add('done');}}
}

// 꿈 감정 패턴 카드



export function renderPatternCard(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream);
  const card=document.getElementById('dreamPatternCard');
  if(!card)return;
  const report=generatePatternReport(logs);
  if(!report||!report.prediction){card.style.display='none';return;}

  card.style.display='block';
  const pred=report.prediction;
  const stateEmoji={평온:'😌',불안:'😰',공포:'😱',기쁨:'😊',슬픔:'😢'};
  const stateColor={평온:'#7de8d8',불안:'#f8c94c',공포:'#f0a8c8',기쁨:'#a67cef',슬픔:'#90b0ff'};

  document.getElementById('patternPredIcon').textContent=stateEmoji[pred.predicted]||'🔮';
  document.getElementById('patternPredTitle').textContent=`다음 꿈 예측: ${pred.predicted} (${pred.probability}%)`;
  document.getElementById('patternPredSub').textContent=`현재 ${stateEmoji[pred.current]||''} ${pred.current} 상태에서 전이`;

  // 감정 분포 바
  const total=report.totalDreams;
  const barsEl=document.getElementById('patternEmotionBars');
  barsEl.innerHTML=report.states.map(s=>{
    const cnt=report.emotionDist[s]||0;
    const pct=total>0?Math.round(cnt/total*100):0;
    return `<div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;width:32px;color:var(--text-muted)">${stateEmoji[s]||''}</span>
      <span style="font-size:10px;width:28px;color:var(--text-secondary)">${esc(s)}</span>
      <div style="flex:1;height:6px;background:rgba(255,255,255,.04);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${stateColor[s]||'#a67cef'};border-radius:3px;transition:width .6s ease"></div>
      </div>
      <span style="font-size:10px;color:var(--text-muted);width:30px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');

  // 반복 클러스터
  const clEl=document.getElementById('patternCluster');
  if(report.clusters.length>0){
    clEl.innerHTML=report.clusters.slice(0,3).map(c=>
      `<span style="display:inline-block;padding:3px 10px;margin:2px;background:rgba(166,124,239,.08);border:1px solid rgba(166,124,239,.12);border-radius:10px;font-size:10px;color:var(--purple-bright)">${esc(c.keyword)} ${c.count}회${c.avgInterval>0?' · ~'+c.avgInterval+'일 간격':''}</span>`
    ).join('');
  }else{
    clEl.innerHTML='';
  }
  // 미니 감정 흐름 차트
  renderEmotionFlowChart('patternEmotionFlow', 14);
  renderSymbolTracker('symbolTrackerMini');
}

// 꿈 성격 프로필
export function renderDreamPersonality(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream);
  const el=document.getElementById('dreamPersonality');
  if(!el||logs.length<3)return;

  el.style.display='block';
  const badges=logs.flatMap(l=>l.badges||[]);
  const good=badges.filter(b=>b==='길몽').length;
  const bad=badges.filter(b=>b==='흉몽').length;
  const money=badges.filter(b=>b==='재물운').length;
  const love=badges.filter(b=>b==='연애운').length;

  // 상징 반복 체크
  const texts=logs.map(l=>l.text||'').join(' ');
  const symbols=['뱀','물','불','이빨','하늘','돈','돼지','귀신','추락','쫓기'];
  const found=symbols.filter(s=>texts.includes(s));
  const isRepeater=found.length<=3&&logs.length>=5;

  let emoji,type,desc,tags=[];

  if(good>bad*2){
    emoji='☀️'; type='빛나는 낙관주의 꿈꾼';
    desc='당신의 꿈은 대부분 밝고 긍정적이에요. 무의식이 세상을 따뜻하게 바라보고 있다는 신호예요.';
    tags=['긍정에너지','밝은무의식','길몽체질'];
  }else if(bad>good){
    emoji='🌊'; type='깊은 감정 탐험가';
    desc='당신의 꿈은 감정의 깊은 곳을 탐험해요. 무의식이 치유가 필요한 부분을 알려주고 있어요.';
    tags=['감수성풍부','내면탐구','치유중'];
  }else if(money>=3){
    emoji='💰'; type='재물 감각의 꿈꾼';
    desc='재물 관련 꿈이 자주 나타나요. 무의식이 기회를 포착하는 안테나가 강한 타입이에요.';
    tags=['재물감각','기회포착','현실감각'];
  }else if(love>=3){
    emoji='💕'; type='사랑의 꿈 감성가';
    desc='관계와 사랑에 대한 꿈이 많아요. 감정이 풍부하고 인간관계에 민감한 타입이에요.';
    tags=['감성풍부','관계중시','사랑체질'];
  }else if(isRepeater){
    emoji='🔄'; type='패턴 반복의 탐구자';
    desc='비슷한 상징이 반복되고 있어요. 무의식이 중요한 메시지를 계속 보내고 있어요.';
    tags=['반복패턴','무의식메시지','직면필요'];
  }else{
    emoji='🌈'; type='다채로운 꿈의 모험가';
    desc='다양한 종류의 꿈을 꾸는 타입이에요. 호기심이 많고 경험에 열려 있는 사람이에요.';
    tags=['호기심왕','다양성','모험심'];
  }

  document.getElementById('dpEmoji').textContent=emoji;
  document.getElementById('dpType').textContent=type;
  document.getElementById('dpDesc').textContent=desc;
  document.getElementById('dpTags').innerHTML=tags.map(t=>'<span style="font-size:10px;padding:3px 10px;border-radius:12px;background:rgba(166,124,239,.08);color:var(--purple-bright);border:1px solid rgba(166,124,239,.12)">'+esc(t)+'</span>').join('');
}

// ── 무의식 미니 프로파일 (꿈 1개부터 노출) ──
export function renderUnconsciousProfile() {
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  const el = document.getElementById('unconsciousProfile');
  if (!el) return;

  if (logs.length < 1) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';

  // 감정/키워드 분석으로 3축 계산
  const texts = logs.map(l => (l.text || '') + ' ' + (l.title || '')).join(' ');
  const badges = logs.flatMap(l => l.badges || []);

  // 욕구 축: 재물운, 연애운, 긍정 키워드
  const desireWords = ['돈', '부자', '집', '차', '성공', '승진', '선물', '보석', '금', '재물'];
  const desireCount = desireWords.filter(w => texts.includes(w)).length + badges.filter(b => b === '재물운' || b === '연애운').length;
  const desire = Math.min(100, Math.round((desireCount / (logs.length * 0.5 + 3)) * 100));

  // 불안 축: 흉몽, 부정 키워드
  const anxietyWords = ['추락', '쫓기', '죽', '도망', '놓치', '늦', '시험', '잃어', '무서', '공포', '귀신', '어둠'];
  const anxietyCount = anxietyWords.filter(w => texts.includes(w)).length + badges.filter(b => b === '흉몽').length;
  const anxiety = Math.min(100, Math.round((anxietyCount / (logs.length * 0.5 + 3)) * 100));

  // 성장 축: 길몽, 긍정 변화 키워드
  const growthWords = ['하늘', '날', '빛', '새', '꽃', '아기', '태양', '별', '산', '오르', '성장', '배우'];
  const growthCount = growthWords.filter(w => texts.includes(w)).length + badges.filter(b => b === '길몽' || b === '태몽').length;
  const growth = Math.min(100, Math.round((growthCount / (logs.length * 0.5 + 3)) * 100));

  const axes = [
    { name: '욕구', value: desire, color: '#f8c94c', emoji: '✨' },
    { name: '불안', value: anxiety, color: '#e74c6f', emoji: '🌊' },
    { name: '성장', value: growth, color: '#5bbfba', emoji: '🌱' },
  ];

  const barsHtml = axes.map(a => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:14px;width:20px">${a.emoji}</span>
      <span style="font-size:11px;width:28px;color:var(--text-secondary)">${a.name}</span>
      <div style="flex:1;height:8px;background:rgba(255,255,255,.04);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${a.value}%;background:${a.color};border-radius:4px;transition:width .8s ease"></div>
      </div>
      <span style="font-size:10px;color:var(--text-muted);width:30px;text-align:right">${a.value}%</span>
    </div>
  `).join('');

  // 후킹 멘트 (꿈 3개+)
  let hookingHtml = '';
  if (logs.length >= 3) {
    let hookMsg = '';
    if (anxiety > desire && anxiety > growth) {
      hookMsg = '혹시 평소에 걱정이 많은 편 아닌가요? 당신의 꿈은 해소되지 않은 감정을 표현하고 있어요.';
    } else if (desire > anxiety && desire > growth) {
      hookMsg = '혹시 최근에 이루고 싶은 목표가 있나요? 무의식이 강한 열망을 보내고 있어요.';
    } else if (growth > anxiety && growth > desire) {
      hookMsg = '혹시 요즘 새로운 시작을 앞두고 있나요? 무의식이 성장의 신호를 보내고 있어요.';
    } else {
      hookMsg = '당신의 무의식은 여러 감정을 균형 있게 탐색하고 있어요. 내면의 균형을 찾아가는 중이에요.';
    }
    hookingHtml = `<div style="background:rgba(91,191,186,.06);border:1px solid rgba(91,191,186,.15);border-radius:10px;padding:10px 12px;margin-top:10px">
      <div style="font-size:11px;color:var(--teal,#5bbfba);line-height:1.6">💡 ${esc(hookMsg)}</div>
    </div>`;
  }

  // 상세 프로파일 CTA (꿈 3개+)
  let ctaHtml = '';
  if (logs.length >= 3) {
    ctaHtml = `<button onclick="showUnconsciousPaywall()" style="margin-top:12px;width:100%;background:linear-gradient(135deg,rgba(91,191,186,.15),rgba(91,191,186,.05));border:1px solid rgba(91,191,186,.25);border-radius:10px;padding:10px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;text-align:center">
      <div style="font-size:12px;font-weight:700;color:var(--teal,#5bbfba)">🧠 무의식 상세 프로파일 보기</div>
      <div style="font-size:9px;color:var(--text-muted);margin-top:2px">5축 심층분석 · 성격 프로파일 · 변화 추적</div>
    </button>`;
  }

  el.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--moon,#f5e6b2);margin-bottom:10px">🧠 무의식 미니 프로파일</div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:12px">꿈 ${logs.length}개 기반 분석</div>
    ${barsHtml}
    ${hookingHtml}
    ${ctaHtml}
  `;
}


// ═══ XP 레벨/칭호 시스템 (Phase 2-4) ═══
const LEVELS=[
  {lv:1,title:'꿈 초보자',emoji:'🌱',minXP:0},
  {lv:2,title:'꿈 탐험가',emoji:'🧭',minXP:50},
  {lv:3,title:'꿈 기록자',emoji:'📖',minXP:150},
  {lv:4,title:'꿈 분석가',emoji:'🔍',minXP:350},
  {lv:5,title:'꿈 해독자',emoji:'🔮',minXP:600},
  {lv:6,title:'꿈 연구가',emoji:'🔬',minXP:1000},
  {lv:7,title:'꿈 마스터',emoji:'🎓',minXP:1500},
  {lv:8,title:'꿈 현자',emoji:'🧙',minXP:2500},
  {lv:9,title:'꿈의 수호자',emoji:'🛡️',minXP:4000},
  {lv:10,title:'꿈의 현인',emoji:'👑',minXP:6000},
];

export function getLevel(xp){
  let lvl=LEVELS[0];
  for(const l of LEVELS){if(xp>=l.minXP)lvl=l;else break;}
  const nextLvl=LEVELS[LEVELS.indexOf(lvl)+1];
  const progress=nextLvl?Math.round((xp-lvl.minXP)/(nextLvl.minXP-lvl.minXP)*100):100;
  return{...lvl,xp,nextXP:nextLvl?nextLvl.minXP:lvl.minXP,progress,nextTitle:nextLvl?nextLvl.title:null};
}
window.getLevel=getLevel;

export function renderLevelCard(){
  const el=document.getElementById('levelCard');
  if(!el)return;
  const lv=getLevel(store.xp||0);
  el.style.display='block';
  el.innerHTML=`<div style="display:flex;align-items:center;gap:12px">
    <div style="font-size:32px">${lv.emoji}</div>
    <div style="flex:1">
      <div style="display:flex;align-items:baseline;gap:6px">
        <span style="font-size:14px;font-weight:900;color:var(--moon)">Lv.${lv.lv} ${lv.title}</span>
        <span style="font-size:10px;color:var(--text-muted)">${lv.xp} XP</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;margin-top:6px;overflow:hidden">
        <div style="height:100%;width:${lv.progress}%;background:linear-gradient(90deg,#a67cef,#f8c94c);border-radius:3px;transition:width .6s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:3px">
        <span style="font-size:9px;color:var(--text-muted)">${lv.progress}%</span>
        ${lv.nextTitle?`<span style="font-size:9px;color:var(--purple-bright)">다음: ${lv.nextTitle} (${lv.nextXP} XP)</span>`:'<span style="font-size:9px;color:var(--amber)">✨ 최고 레벨!</span>'}
      </div>
    </div>
  </div>`;
}
window.renderLevelCard=renderLevelCard;
export function addXP(n){
  const prevLv=getLevel(store.xp);store.xp+=n;localStorage.setItem('mg_xp',store.xp);const newLv=getLevel(store.xp);updateStats();renderDreamPersonality();renderPatternCard();renderLevelCard();if(newLv.lv>prevLv.lv)showToast(newLv.emoji+' 레벨 업! '+newLv.title+' 달성!');
  if(n>=20)addStardust(Math.floor(n/5),'해몽');
  // XP 플로트 애니메이션 — [2026-05-23] 폴리시3: top 40%→14%(입력칸/결과 텍스트 위 겹침 제거, 상단 표시)
  const float=document.createElement('div');
  float.textContent='+'+n+' XP';
  float.style.cssText='position:fixed;top:14%;left:50%;transform:translateX(-50%);z-index:9999;font-size:24px;font-weight:900;color:var(--amber);text-shadow:0 0 12px rgba(248,201,76,.5);pointer-events:none;animation:xpFloat 1.5s ease-out forwards;';
  document.body.appendChild(float);
  setTimeout(()=>float.remove(),1500);
}
export function addXPSilent(n){store.xp+=n;localStorage.setItem('mg_xp',store.xp);updateStats();}

// 스트릭 리셋 체크 (하루 이상 놓치면 0으로)
export function checkStreakReset(){
  if(!store.lastCin)return;
  const last=new Date(store.lastCin);
  const now=new Date();
  const diff=Math.floor((now-last)/(1000*60*60*24));
  if(diff>=2){
    store.streak=0;
    localStorage.setItem('mg_streak','0');
  }
}

export function doCheckin(){
  const today=new Date().toDateString();
  if(store.lastCin===today){showToast('오늘 출석은 이미 했어요 🌙');return;}
  checkStreakReset();
  store.xp+=10;store.streak++;store.lastCin=today;
  localStorage.setItem('mg_xp',store.xp);localStorage.setItem('mg_streak',store.streak);localStorage.setItem('mg_cin',today);
  addStardust(3,'출석');
  renderAchievements();
  showToast('출석 완료! +10 XP +3 별가루 🔥 '+store.streak+'일 연속');
}

export function renderCalendar(){
  const el=document.getElementById('dreamCalendar');if(!el)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  // 날짜별 꿈 데이터 매핑 (길몽/흉몽 색상)
  const dreamByDate={};
  logs.forEach(l=>{if(l.date){
    const type=(l.badges||[]).includes('흉몽')?'bad':(l.badges||[]).includes('길몽')?'good':'neutral';
    dreamByDate[l.date]=type;
  }});
  const today=new Date();
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const monthNames=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const dayLabels=['일','월','화','수','목','금','토'];
  let html=`<div class="cal-header">
    <button class="cal-nav" onclick="prevMonth()">‹</button>
    <span class="cal-title">${calYear}년 ${monthNames[calMonth]}</span>
    <button class="cal-nav" onclick="nextMonth()">›</button>
  </div>
  <div class="cal-grid">
    ${dayLabels.map(d=>`<div class="cal-day-label">${d}</div>`).join('')}`;
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-day other-month"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${calYear}. ${calMonth+1}. ${d}.`;
    const dreamType=dreamByDate[dateStr];
    const isToday=d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
    const cls=dreamType==='good'?' has-dream cal-good':dreamType==='bad'?' has-dream cal-bad':dreamType==='neutral'?' has-dream':'';
    html+=`<div class="cal-day${cls}${isToday?' today':''}" onclick="showToast(this.dataset.tip)" data-tip="꿈 기록">${d}</div>`;
  }
  html+=`</div>`;
  el.innerHTML=html;
}

export function prevMonth(){if(calMonth===0){calYear--;calMonth=11;}else calMonth--;renderCalendar();}
export function nextMonth(){if(calMonth===11){calYear++;calMonth=0;}else calMonth++;renderCalendar();}

export function detectRepeatDreams(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length<2)return;
  const symbolCounts={};
  const symbols=['뱀','물','불','이빨','치아','추락','비행','하늘','돈','전애인','부모','아기','귀신','시험'];
  logs.slice(0,14).forEach(l=>{
    symbols.forEach(s=>{if(l.text&&l.text.includes(s)){symbolCounts[s]=(symbolCounts[s]||0)+1;}});
  });
  const repeated=Object.entries(symbolCounts).filter(([,v])=>v>=2).sort((a,b)=>b[1]-a[1]);
  const alertEl=document.getElementById('repeatDreamAlert');
  const bodyEl=document.getElementById('repeatDreamBody');
  if(repeated.length>0&&alertEl&&bodyEl){
    alertEl.style.display='flex';
    bodyEl.innerHTML=repeated.map(([k,v])=>`<strong>${esc(k)}</strong> 관련 꿈 <strong>${v}회</strong>`).join(' · ')+'<br><span style="font-size:11px;color:var(--text-muted)">최근 14일 기준</span>';
  }
}

export async function openReportPage(){
  const tier = await getUserTier();
  if(tier==='free'){
    showPaywall('weekly_report');
    return;
  }
  logEvent('report_opened');
  trackFunnelStep('retention_action',{action:'report_opened'});
  renderReport();
}

export function closeReportPage(){document.getElementById('reportPage').classList.remove('on');}

export function changeReportWeek(d){
  reportWeekOffset+=d;
  if(reportWeekOffset>0)reportWeekOffset=0;
  if(reportWeekOffset<-3)reportWeekOffset=-3;
  renderReport();
}

export function renderReport(){
  const lbl=document.getElementById('rwsLabel');
  if(reportWeekOffset===0)lbl.textContent='이번 주 리포트';
  else if(reportWeekOffset===-1)lbl.textContent='지난 주 리포트';
  else lbl.textContent=`${Math.abs(reportWeekOffset)}주 전 리포트`;

  const data=REPORT_DATA[Math.abs(reportWeekOffset)%REPORT_DATA.length];
  document.getElementById('reportHeroEmoji').textContent=data.emoji;
  document.getElementById('reportHeroTitle').textContent=data.title;
  document.getElementById('reportHeroSub').textContent=data.sub;
  document.getElementById('rStatDays').textContent=data.days;
  document.getElementById('rStatDreams').textContent=data.dreams;
  document.getElementById('rStatLuck').textContent=data.luck;

  document.getElementById('reportEmoBars').innerHTML=data.emos.map(e=>`
    <div class="emo-bar-row">
      <span class="emo-bar-label">${e.l}</span>
      <div class="emo-bar-wrap"><div class="emo-bar-fill" style="width:0%;background:${e.c}" data-w="${e.v}"></div></div>
      <span class="emo-bar-pct">${e.v}%</span>
    </div>`).join('');
  setTimeout(()=>{document.querySelectorAll('.emo-bar-fill').forEach(b=>b.style.width=b.dataset.w+'%');},80);

  document.getElementById('reportSymbolRank').innerHTML=data.symbols.map((s,i)=>`
    <div class="symbol-rank-item">
      <span class="sym-rank-no">${i+1}</span>
      <span class="sym-rank-emoji">${s.e}</span>
      <div class="sym-rank-info"><div class="sym-rank-name">${s.n}</div><div class="sym-rank-cnt">${s.c} 등장</div></div>
      <span class="sym-rank-badge badge ${s.b==='길몽'||s.b==='대길'?'bv':s.b==='주의'?'bb':'bl'}">${s.b}</span>
    </div>`).join('');

  document.getElementById('reportLuckGrid').innerHTML=data.lucks.map(l=>`
    <div class="luck-card ${l.type}">
      <div class="luck-card-icon">${l.icon}</div>
      <div class="luck-card-label">${l.label}</div>
      <div class="luck-card-val">${l.val}</div>
    </div>`).join('');

  // 달이 내러티브 (실제 데이터 기반)
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length>=3){
    const weekLogs=logs.slice(0,7);
    const emos=weekLogs.map(l=>l.emotion||'').filter(Boolean);
    const badges=weekLogs.flatMap(l=>l.badges||[]);
    const good=badges.filter(b=>b==='길몽').length;
    const bad=badges.filter(b=>b==='흉몽').length;
    const kwCount={};
    weekLogs.forEach(l=>(l.keywords||[]).forEach(k=>{kwCount[k]=(kwCount[k]||0)+1;}));
    const topKw=Object.entries(kwCount).sort((a,b)=>b[1]-a[1])[0];
    const mainEmo=emos.length>0?emos.reduce((a,c,_,arr)=>arr.filter(v=>v===c).length>arr.filter(v=>v===a).length?c:a,emos[0]):'';

    let narrative=`이번 주 ${weekLogs.length}개의 꿈을 분석했어요. `;
    if(good>bad) narrative+=`길몽이 ${good}개로 좋은 흐름이에요! `;
    else if(bad>good) narrative+=`흉몽이 ${bad}개로 마음이 무거울 수 있어요. `;
    if(topKw) narrative+=`"${topKw[0]}" 키워드가 ${topKw[1]}번 반복됐는데, 무의식이 강하게 신호를 보내고 있어요. `;
    if(mainEmo) narrative+=`전반적으로 "${mainEmo}" 감정이 많았어요. `;

    // 패턴 엔진 예측 추가
    const report=generatePatternReport(logs);
    if(report&&report.prediction){
      const pred=report.prediction;
      narrative+=`다음 꿈은 "${pred.predicted}" 계열일 확률이 ${pred.probability}%예요. `;
    }
    if(report&&report.clusters.length>0){
      const top=report.clusters[0];
      narrative+=`"${top.keyword}"가 ${top.count}번 반복되고 있어서 주의깊게 볼 필요가 있어요. `;
    }

    narrative+=good>=bad?'꿈의 기운이 좋은 방향으로 흐르고 있어요 🌙':'충분히 쉬면서 마음을 돌봐주세요 🐱';

    document.getElementById('reportAiText').innerHTML=sanitize(narrative);
  }else{
    document.getElementById('reportAiText').innerHTML=sanitize(data.ai||'');
  }
}

// ══ 월간 리포트 (Phase 2-2) ══

// ══ 달이 주간 서머리 자동 생성 (Phase 2-2) ══
export function generateDaliWeeklySummary(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length<3)return null;

  const weekLogs=logs.filter(function(l){
    if(!l.date)return false;
    var parts=l.date.replace(/\./g,'').trim().split(/\s+/);
    if(parts.length<3)return false;
    var d=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
    var diff=(Date.now()-d.getTime())/(1000*60*60*24);
    return diff<=7;
  });

  if(weekLogs.length===0)return null;

  var badges=weekLogs.flatMap(function(l){return l.badges||[];});
  var good=badges.filter(function(b){return b==='길몽';}).length;
  var bad=badges.filter(function(b){return b==='흉몽';}).length;
  var kwCount={};
  weekLogs.forEach(function(l){
    (l.text||'').split(/\s+/).forEach(function(w){
      if(w.length>=2)kwCount[w]=(kwCount[w]||0)+1;
    });
  });
  var topKw=Object.entries(kwCount).sort(function(a,b){return b[1]-a[1];})[0];

  var summary='이번 주 '+weekLogs.length+'개 꿈을 분석했어요. ';
  if(good>bad)summary+='전반적으로 밝은 꿈이 많았어요 🌟 ';
  else if(bad>good)summary+='무거운 꿈이 있었지만, 그것도 무의식의 메시지예요 🌙 ';
  if(topKw)summary+='"'+topKw[0]+'"이(가) 자주 나타났는데, 마음속에서 중요한 주제인 것 같아요. ';
  summary+='다음 주도 꿈을 기록하면 더 깊은 패턴을 알려줄게요!';

  return{text:summary,dreamCount:weekLogs.length,goodCount:good,badCount:bad,topKeyword:topKw?topKw[0]:null};
}

export function toggleDictItem(n){
  const el=document.getElementById('di_'+n);
  if(!el)return;
  const isOpen=el.classList.contains('expanded');
  document.querySelectorAll('.dict-item').forEach(d=>d.classList.remove('expanded'));
  if(!isOpen)el.classList.add('expanded');
}

export function shareFortune(){
  const title=document.getElementById('fortuneTitle')?.textContent||'';
  const msg=document.getElementById('fortuneMsg')?.textContent||'';
  const text='🌙 오늘의 꿈 운세: '+title+'\n'+msg+'\n\n— 몽글몽글에서';
  if(navigator.share)navigator.share({title:'몽글몽글 꿈 운세',text});
  else{navigator.clipboard.writeText(text);showToast('운세가 복사됐어요! 📋');}
}

export function initTodayFortune(){
  const day=Math.floor(Date.now()/(1000*60*60*24));
  const f=FORTUNES[day%FORTUNES.length];
  const el=id=>document.getElementById(id);
  if(el('fortuneEmoji'))el('fortuneEmoji').textContent=f.emoji;
  if(el('fortuneTitle'))el('fortuneTitle').textContent=f.title;
  if(el('fortuneMsg'))el('fortuneMsg').textContent=f.msg;
  if(el('fortuneLucky'))el('fortuneLucky').textContent=f.lucky;
  if(el('fortuneColor'))el('fortuneColor').textContent=f.color;
  if(el('fortuneNum'))el('fortuneNum').textContent=f.num;
  if(el('fortuneTip'))el('fortuneTip').textContent=f.tip;
  // 운세 확인 카운터
  var cnt=parseInt(localStorage.getItem('mg_fortune_cnt')||'0');
  localStorage.setItem('mg_fortune_cnt',String(cnt+1));
  // 패턴 예측 결합 (Phase 2-4)
  try{
    var report=generatePatternReport(JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream));
    if(report&&report.prediction){
      var pred=report.prediction;
      var stateEmoji={평온:'😌',불안:'😰',공포:'😱',기쁨:'😊',슬픔:'😢'};
      var patternEl=el('fortunePattern');
      if(!patternEl){
        patternEl=document.createElement('div');
        patternEl.id='fortunePattern';
        patternEl.style.cssText='margin-top:10px;padding:10px 12px;background:rgba(166,124,239,.06);border:1px solid rgba(166,124,239,.12);border-radius:12px;font-size:11px;line-height:1.6';
        var fortuneCard=document.querySelector('.fortune-card')||el('fortuneMsg')?.parentElement;
        if(fortuneCard)fortuneCard.appendChild(patternEl);
      }
      patternEl.innerHTML='<div style="font-weight:700;color:var(--purple-bright);margin-bottom:4px">🔮 꿈 패턴 예측</div>'
        +'<div style="color:var(--text-secondary)">현재 '+(stateEmoji[pred.current]||'')+' <strong>'+pred.current+'</strong> 상태 → 다음 꿈은 '+(stateEmoji[pred.predicted]||'')+' <strong>'+pred.predicted+'</strong> 확률 <strong>'+pred.probability+'%</strong></div>'
        +(report.clusters.length>0?'<div style="color:var(--text-muted);margin-top:4px;font-size:10px">반복 상징: '+report.clusters.slice(0,2).map(c=>c.keyword+' ('+c.count+'회)').join(', ')+'</div>':'');
    }
  }catch(e){}
}

export function initQuiz(){
  const today=new Date().toDateString();
  if(localStorage.getItem('mg_quiz_date')===today){
    quizState.todayDone=true;
    const card=document.getElementById('quizCard');
    if(card){
      const score=parseInt(localStorage.getItem('mg_quiz_score')||'0');
      card.innerHTML=`<div style="text-align:center;padding:8px 0"><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">✦ 오늘의 퀴즈 완료!</div><div style="font-size:14px;font-weight:700;color:var(--moon)">3문제 중 ${score}개 맞춤 🎉</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">내일 새로운 퀴즈가 준비돼요</div></div>`;
    }
    return;
  }
  const day=Math.floor(Date.now()/(1000*60*60*24));
  const shuffled=[...QUIZ_DATA].sort((a,b)=>{
    const ha=(day*31+QUIZ_DATA.indexOf(a)*7)%100;
    const hb=(day*31+QUIZ_DATA.indexOf(b)*7)%100;
    return ha-hb;
  });
  window._todayQuiz=shuffled.slice(0,3);
  quizState={idx:0,correct:0,todayDone:false,answered:false};
  renderQuiz();
}


// ── Phase 2: 데일리 퀴즈 (1일 1문제, 연속 정답 스트릭) ──
export function renderDailyQuiz() {
  var today = new Date().toISOString().split('T')[0];
  var dailyState = JSON.parse(localStorage.getItem('mg_daily_quiz') || '{}');
  if (dailyState.date === today && dailyState.answered) { _showDailyResult(dailyState); return; }

  var seed = parseInt(today.replace(/-/g, ''));
  var idx = seed % QUIZ_DATA.length;
  var q = QUIZ_DATA[idx];

  var el = document.getElementById('dailyQuizArea');
  if (!el) {
    var quizWrap = document.getElementById('quizWrap');
    if (!quizWrap) return;
    el = document.createElement('div'); el.id = 'dailyQuizArea'; el.style.cssText = 'margin-bottom:14px';
    quizWrap.parentElement.insertBefore(el, quizWrap);
  }

  el.style.display = 'block';
  var streak = parseInt(localStorage.getItem('mg_quiz_streak') || '0');
  el.innerHTML = '<div style="background:linear-gradient(135deg,rgba(166,124,239,.08),rgba(248,201,76,.06));border:1px solid rgba(166,124,239,.15);border-radius:14px;padding:14px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-size:12px;font-weight:700;color:var(--moon)">🧠 오늘의 꿈 퀴즈</span>'
    + (streak > 0 ? '<span style="font-size:10px;color:var(--amber)">🔥 ' + streak + '일 연속 정답</span>' : '')
    + '</div><div style="font-size:13px;color:var(--text-primary);margin-bottom:12px;line-height:1.5">' + (q.cat ? '<span style="font-size:9px;background:rgba(166,124,239,.12);border-radius:6px;padding:1px 6px;color:var(--purple-bright);margin-right:6px">' + q.cat + '</span>' : '') + q.q + '</div>'
    + q.opts.map(function(opt, oi) {
      return '<button class="daily-quiz-opt" data-ans="' + oi + '" onclick="window._answerDQ(' + idx + ',' + oi + ')" style="display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;margin-bottom:6px;font-size:12px;color:var(--text-secondary);cursor:pointer;font-family:inherit;transition:all .2s">' + esc(opt) + '</button>';
    }).join('') + '</div>';
}

function _showDailyResult(state) {
  var el = document.getElementById('dailyQuizArea');
  if (!el) return;
  el.style.display = 'block';
  var streak = parseInt(localStorage.getItem('mg_quiz_streak') || '0');
  el.innerHTML = '<div style="background:linear-gradient(135deg,rgba(166,124,239,.08),rgba(248,201,76,.06));border:1px solid rgba(166,124,239,.15);border-radius:14px;padding:14px;text-align:center">'
    + '<div style="font-size:14px;font-weight:700;color:' + (state.correct ? 'var(--teal)' : 'var(--text-muted)') + ';margin-bottom:6px">' + (state.correct ? '✅ 정답!' : '❌ 아쉬워요') + '</div>'
    + '<div style="font-size:11px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px">' + esc(state.explain || '') + '</div>'
    + (streak > 0 ? '<div style="font-size:10px;color:var(--amber)">🔥 ' + streak + '일 연속 정답!</div>' : '<div style="font-size:10px;color:var(--text-muted)">내일 다시 도전해보세요!</div>')
    + '</div>';
}

window._answerDQ = function(qIdx, ansIdx) {
  var q = QUIZ_DATA[qIdx]; if (!q) return;
  var correct = ansIdx === q.answer;
  var today = new Date().toISOString().split('T')[0];
  var streak = parseInt(localStorage.getItem('mg_quiz_streak') || '0');
  var lastDate = localStorage.getItem('mg_quiz_last_date') || '';
  var yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (correct) { streak = (lastDate === yesterday || lastDate === today) ? streak + 1 : 1; } else { streak = 0; }
  localStorage.setItem('mg_quiz_streak', String(streak));
  localStorage.setItem('mg_quiz_last_date', today);
  var state = { date: today, answered: true, correct: correct, explain: q.explain };
  localStorage.setItem('mg_daily_quiz', JSON.stringify(state));
  var btns = document.querySelectorAll('.daily-quiz-opt');
  btns.forEach(function(btn) {
    var idx = parseInt(btn.dataset.ans); btn.disabled = true; btn.style.cursor = 'default';
    if (idx === q.answer) { btn.style.background = 'rgba(125,232,216,.15)'; btn.style.borderColor = 'rgba(125,232,216,.3)'; btn.style.color = 'var(--teal)'; }
    else if (idx === ansIdx && !correct) { btn.style.background = 'rgba(240,168,200,.15)'; btn.style.borderColor = 'rgba(240,168,200,.3)'; btn.style.color = '#f0a8c8'; }
  });
  setTimeout(function() { _showDailyResult(state); }, 1500);
  if (typeof addXP === 'function') addXP(correct ? 20 : 5);
  logEvent('daily_quiz_answered', { correct: correct, streak: streak });
};

window.renderDailyQuiz = renderDailyQuiz;

export function renderQuiz(){
  if(quizState.todayDone||!window._todayQuiz)return;
  const q=window._todayQuiz[quizState.idx];
  if(!q)return;
  document.getElementById('quizProgress').textContent=`${quizState.idx+1}/3`;
  document.getElementById('quizQuestion').textContent=q.q;
  document.getElementById('quizResult').style.display='none';
  quizState.answered=false;
  document.getElementById('quizOptions').innerHTML=q.opts.map((o,i)=>
    `<button class="abtn" style="justify-content:flex-start;padding:11px 14px;font-size:13px" onclick="answerQuiz(${i})">${o}</button>`
  ).join('');
}

export function answerQuiz(idx){
  if(quizState.answered||quizState.todayDone)return;
  quizState.answered=true;
  const q=window._todayQuiz[quizState.idx];
  const correct=idx===q.answer;
  if(correct)quizState.correct++;
  const btns=document.getElementById('quizOptions').children;
  for(let i=0;i<btns.length;i++){
    if(i===q.answer)btns[i].style.cssText+='background:rgba(125,232,216,.2);border-color:rgba(125,232,216,.4);color:var(--teal);';
    else if(i===idx&&!correct)btns[i].style.cssText+='background:rgba(240,100,100,.15);border-color:rgba(240,100,100,.3);color:#f08080;';
    btns[i].onclick=null;
  }
  const result=document.getElementById('quizResult');
  result.style.display='block';
  document.getElementById('quizResultEmoji').textContent=correct?'🎉':'💡';
  document.getElementById('quizResultText').innerHTML=`${correct?'정답!':'아쉽지만...'} ${q.explain}`;
  setTimeout(()=>{
    quizState.idx++;
    if(quizState.idx>=3){
      localStorage.setItem('mg_quiz_date',new Date().toDateString());
      localStorage.setItem('mg_quiz_score',String(quizState.correct));
      quizState.todayDone=true;
      const reward=quizState.correct*3;
      const card=document.getElementById('quizCard');
      if(card)card.innerHTML=`<div style="text-align:center;padding:8px 0"><div style="font-size:28px;margin-bottom:6px">🎉</div><div style="font-size:14px;font-weight:700;color:var(--moon)">3문제 중 ${quizState.correct}개 정답!</div><div style="font-size:12px;color:var(--teal);margin-top:4px">+${reward} XP +${reward} 꿈가루</div></div>`;
    }else{
      renderQuiz();
    }
  },2000);
}

export function checkYesterdayReview(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const now=Date.now();
  const candidate=logs.find(l=>!l.noDream&&!l.review&&l.id&&(now-l.id)>3*24*60*60*1000);
  if(!candidate)return;
  const el=document.getElementById('yesterdayReview');
  if(!el)return;
  el.style.display='block';
  document.getElementById('reviewDreamTitle').textContent=candidate.title||'꿈 기록';
  document.getElementById('reviewDreamText').textContent=candidate.text.substring(0,80)+'...';
  window._reviewTarget=candidate;
}

export function submitPastReview(val,btn){
  if(!window._reviewTarget)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const target=logs.find(l=>l.id===window._reviewTarget.id);
  if(target){target.review=val;localStorage.setItem('mg_logs',JSON.stringify(logs));}
  const el=document.getElementById('yesterdayReview');
  if(el)el.innerHTML=`<div style="text-align:center;padding:8px 0"><div style="font-size:13px;color:var(--teal)">✓ 후기 완료! ${val} · +5 XP ✨</div></div>`;
}

export function nextOnbStep(n){
  document.querySelectorAll('.onb-step').forEach(s=>s.style.display='none');
  const step=document.getElementById('onbStep'+n);
  if(step){step.style.display='block';step.style.animation='su .35s ease';}
}

export function claimOnboarding(){
  localStorage.setItem('mg_onboarded','true');
  // 온보딩 선물 화면(index.html onbStep2)이 '상세 해몽 5회 무료'를 약속 → 실제도 5회 지급(이전 3회=약속 불일치)
  localStorage.setItem('mg_free_unlocks','5');
  document.getElementById('onboardingOverlay').style.display='none';
  showToast('🎁 환영 선물을 받았어요!');
}

export function showOnboarding(){
  if(localStorage.getItem('mg_onboarded'))return;
  const overlay=document.getElementById('onboardingOverlay');
  if(overlay)overlay.style.display='flex';
}

export function getFreeUnlocks(){return parseInt(localStorage.getItem('mg_free_unlocks')||'0');}
export function useFreeUnlock(){
  const n=getFreeUnlocks();
  if(n<=0)return false;
  localStorage.setItem('mg_free_unlocks',String(n-1));
  return true;
}

// ── 포인트(별가루) 시스템 — 나중에 상점 BM 연결용 ──
export function getStardust(){return parseInt(localStorage.getItem('mg_stardust')||'0');}
export function addStardust(n,reason){
  const cur=getStardust();
  const next=cur+n;
  localStorage.setItem('mg_stardust',String(next));
  // 적립 내역 기록
  const history=JSON.parse(localStorage.getItem('mg_stardust_log')||'[]');
  history.unshift({amount:n,reason,total:next,date:new Date().toISOString()});
  localStorage.setItem('mg_stardust_log',JSON.stringify(history.slice(0,100)));
  updateStardustUI();
  return next;
}
export function spendStardust(n){
  const cur=getStardust();
  if(cur<n)return false;
  localStorage.setItem('mg_stardust',String(cur-n));
  updateStardustUI();
  return true;
}
function updateStardustUI(){
  const el=document.getElementById('stardustCount');
  if(el)el.textContent=getStardust();
}

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

// window 노출
window.searchDreamLog = searchDreamLog;
window.resetAllData = resetAllData;
window.editNickname = editNickname;
window.exportDreamLog = exportDreamLog;
window.renderLog = renderLog;
window.submitReview = submitReview;
window.deleteDreamLog = deleteDreamLog;
window.updateStats = updateStats;
window.addXP = addXP;
window.doCheckin = doCheckin;
window.renderCalendar = renderCalendar;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.detectRepeatDreams = detectRepeatDreams;
window.openReportPage = openReportPage;
window.closeReportPage = closeReportPage;
window.changeReportWeek = changeReportWeek;
window.renderReport = renderReport;
window.openFlowPage = openFlowPage;
window.closeFlowPage = closeFlowPage;
window.setFlowPeriod = setFlowPeriod;
window.openDictPage = openDictPage;
window.closeDictPage = closeDictPage;
window.setDictCategory = setDictCategory;
window.filterDict = filterDict;
window.renderDict = renderDict;
window.toggleDictItem = toggleDictItem;
window.shareFortune = shareFortune;
window.initTodayFortune = initTodayFortune;
window.initQuiz = initQuiz;
window.renderQuiz = renderQuiz;
window.answerQuiz = answerQuiz;
window.checkYesterdayReview = checkYesterdayReview;
window.submitPastReview = submitPastReview;
window.nextOnbStep = nextOnbStep;
window.claimOnboarding = claimOnboarding;
window.showOnboarding = showOnboarding;
window.showExportModal = showExportModal;
window.getFreeUnlocks = getFreeUnlocks;
window.useFreeUnlock = useFreeUnlock;
window.addXPSilent = addXPSilent;
window.renderUnconsciousProfile = renderUnconsciousProfile;
window.showUnconsciousPaywall = showUnconsciousPaywall;
// [버그수정] 아래 함수들이 window 에 노출 안 돼 app.js 의 window.fn?.() 호출(init/탭전환)이
// 항상 no-op 였음 → 업적/꿈성격/패턴/갤러리/연속리셋체크가 init 시 미작동.
// (deleteDreamLog 등 일부 내부 경로로만 우연히 렌더됐음). 정상 노출.
window.renderAchievements = renderAchievements;
window.renderDreamPersonality = renderDreamPersonality;
window.renderDreamGallery = renderDreamGallery;
window.renderPatternCard = renderPatternCard;
window.checkStreakReset = checkStreakReset;


// ── 썸네일 인젝션 (renderLog 후처리) ──
function injectThumbnails(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  document.querySelectorAll('.log-item').forEach((item,idx)=>{
    const l=logs[idx];
    if(!l||!l.thumbnail)return;
    if(item.querySelector('.log-thumb'))return;
    const ttl=item.querySelector('.log-ttl');
    if(!ttl)return;
    const thumb=document.createElement('div');
    thumb.className='log-thumb';
    thumb.style.cssText='border-radius:10px;overflow:hidden;margin-bottom:6px;max-height:120px;cursor:pointer';
    thumb.onclick=function(){window.openDreamGallery(idx);};
    thumb.innerHTML='<img src="'+l.thumbnail+'" style="width:100%;display:block;object-fit:cover;max-height:120px;border-radius:10px" alt="꿈 이미지" loading="lazy">';
    ttl.parentElement.insertBefore(thumb,ttl);
  });
}

// ── 비교 체크박스 인젝션 ──
function injectCompareCheckboxes(){
  const items=document.querySelectorAll('.log-item');
  items.forEach((item,idx)=>{
    if(item.querySelector('.dream-compare-cb'))return;
    const hd=item.querySelector('.log-hd');
    if(!hd)return;
    const label=document.createElement('label');
    label.style.cssText='margin-right:6px;display:inline-flex;align-items:center';
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.className='dream-compare-cb';
    cb.dataset.idx=idx;
    cb.style.cssText='accent-color:#a67cef;width:13px;height:13px;cursor:pointer';
    cb.onchange=function(){window.updateCompareSelection();};
    label.appendChild(cb);
    hd.insertBefore(label,hd.firstChild);
  });
}

// ── 이미지 갤러리 (MY탭 그리드) ──
export function renderDreamGallery(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>l.thumbnail);
  let wrap=document.getElementById('dreamGalleryWrap');
  if(logs.length===0){if(wrap)wrap.style.display='none';return;}
  if(!wrap){
    const logList=document.getElementById('logList');
    if(!logList)return;
    wrap=document.createElement('div');
    wrap.id='dreamGalleryWrap';
    wrap.style.cssText='margin-bottom:14px';
    logList.parentElement.insertBefore(wrap,logList);
  }
  wrap.style.display='block';
  const allLogs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  wrap.innerHTML='<div class="sec-title" style="display:flex;justify-content:space-between;align-items:center"><span>\uD83C\uDF04 \uAFC8 \uC774\uBBF8\uC9C0 \uAC24\uB7EC\uB9AC</span><span style="font-size:10px;color:var(--text-muted)">'+logs.length+'\uC7A5</span></div><div id="dreamGalleryGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"></div>';
  const grid=document.getElementById('dreamGalleryGrid');
  grid.innerHTML=logs.slice(0,12).map(function(l){
    const realIdx=allLogs.findIndex(function(x){return x.id===l.id;});
    return '<div style="aspect-ratio:1;border-radius:10px;overflow:hidden;cursor:pointer;border:1px solid rgba(166,124,239,.15);position:relative" onclick="openDreamGallery('+realIdx+')">'
      +'<img src="'+l.thumbnail+'" style="width:100%;height:100%;object-fit:cover" alt="'+esc(l.title||'\uAFC8')+'" loading="lazy">'
      +'<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(14,12,26,.8));padding:4px 6px;font-size:8px;color:var(--text-secondary)">'+esc(l.title||'')+'</div>'
      +'</div>';
  }).join('');
}

// ── 이미지 탭 -> 해당 해몽 상세 모달 ──
window.openDreamGallery=function(idx){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const dream=logs[idx];
  if(!dream)return;
  let modal=document.getElementById('dreamDetailModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='dreamDetailModal';
    modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.95);z-index:9999;overflow-y:auto;padding:20px;animation:su .3s ease';
    document.body.appendChild(modal);
  }
  modal.style.display='block';
  const bm={길몽:'bl',태몽:'bl',재물운:'bl',흉몽:'bb',연애운:'bv',건강운:'bv'};
  const closeHandler="document.getElementById('dreamDetailModal').style.display='none'";
  modal.innerHTML='<div style="max-width:480px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div style="font-size:16px;font-weight:900;color:var(--moon)">'+esc(dream.title||'\uAFC8 \uAE30\uB85D')+'</div><button onclick="'+closeHandler+'" style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer">\u2715</button></div>'
    +(dream.thumbnail?'<div style="border-radius:14px;overflow:hidden;margin-bottom:14px"><img src="'+dream.thumbnail+'" style="width:100%;display:block;border-radius:14px" alt="\uAFC8"></div>':'')
    +'<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">'+esc(dream.date||'')+'</div>'
    +'<div style="margin-bottom:8px">'+(dream.badges||[]).map(function(b){return '<span class="badge '+(bm[b]||'bl')+'" style="font-size:10px;padding:2px 7px">'+esc(b)+'</span>';}).join('')+'</div>'
    +(dream.emotions&&dream.emotions.length?'<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">'+dream.emotions.map(function(e){return '<span style="font-size:10px;background:rgba(166,124,239,.1);border-radius:8px;padding:2px 6px;color:var(--text-muted)">'+esc(e)+'</span>';}).join('')+'</div>':'')
    +'<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;margin-bottom:14px;white-space:pre-wrap">'+esc(dream.text||'')+'</div>'
    +'<button onclick="'+closeHandler+'" style="width:100%;background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:12px;padding:10px;font-size:12px;color:var(--purple-bright);cursor:pointer">\uB2EB\uAE30</button>'
    +'</div>';
  logEvent('gallery_dream_viewed',{idx:idx});
  trackFunnelStep('retention_action',{action:'gallery_view'});
};

// ── 두 꿈 비교 선택 ──
let _compareSlots=[];
window.updateCompareSelection=function(){
  const checks=document.querySelectorAll('.dream-compare-cb:checked');
  _compareSlots=Array.from(checks).map(function(cb){return parseInt(cb.dataset.idx);}).slice(0,2);
  let bar=document.getElementById('compareBar');
  if(_compareSlots.length>=1){
    if(!bar){
      bar=document.createElement('div');bar.id='compareBar';
      bar.style.cssText='position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(166,124,239,.95);border-radius:16px;padding:10px 20px;z-index:9990;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,.4);animation:su .2s ease';
      document.body.appendChild(bar);
    }
    if(_compareSlots.length===1){
      bar.innerHTML='<span style="font-size:12px;color:#fff">1\uAC1C \uC120\uD0DD - \uBE44\uAD50\uD560 \uAFC8 1\uAC1C\uB97C \uB354 \uC120\uD0DD\uD558\uC138\uC694</span><button onclick="clearCompareSelection()" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;padding:4px 10px;font-size:11px;color:#fff;cursor:pointer">\uCDE8\uC18C</button>';
    }else{
      bar.innerHTML='<span style="font-size:12px;color:#fff">2\uAC1C \uC120\uD0DD</span><button onclick="showDreamCompare()" style="background:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;color:#a67cef;font-weight:700;cursor:pointer">\uBE44\uAD50\uD558\uAE30</button><button onclick="clearCompareSelection()" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;padding:4px 10px;font-size:11px;color:#fff;cursor:pointer">\uCDE8\uC18C</button>';
      document.querySelectorAll('.dream-compare-cb').forEach(function(cb){if(!cb.checked)cb.disabled=true;});
    }
  }else{
    if(bar)bar.remove();
    document.querySelectorAll('.dream-compare-cb').forEach(function(cb){cb.disabled=false;});
  }
};

window.clearCompareSelection=function(){
  _compareSlots=[];
  document.querySelectorAll('.dream-compare-cb').forEach(function(cb){cb.checked=false;cb.disabled=false;});
  var bar=document.getElementById('compareBar');if(bar)bar.remove();
};

window.showDreamCompare=function(){
  if(_compareSlots.length!==2)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const a=logs[_compareSlots[0]],b=logs[_compareSlots[1]];
  if(!a||!b)return;

  let modal=document.getElementById('dreamCompareModal');
  if(!modal){
    modal=document.createElement('div');modal.id='dreamCompareModal';
    modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.95);z-index:9999;overflow-y:auto;padding:20px;animation:su .3s ease';
    document.body.appendChild(modal);
  }
  modal.style.display='block';

  const wordsA=(a.text||'').split(/\s+/).filter(function(w){return w.length>=2;});
  const wordsB=(b.text||'').split(/\s+/).filter(function(w){return w.length>=2;});
  const common=wordsA.filter(function(w){return wordsB.includes(w);});
  const sim=wordsA.length+wordsB.length>0?Math.round(common.length*2/(wordsA.length+wordsB.length)*100):0;

  const statsA=a.stats||{},statsB=b.stats||{};
  const keys=Object.keys(statsA).length?Object.keys(statsA):Object.keys(statsB);
  const diffHtml=keys.map(function(k){
    const va=statsA[k]||0,vb=statsB[k]||0,d=va-vb;
    return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0"><span style="color:var(--text-muted)">'+k+'</span><span><span style="color:#c8a8ff">'+va+'</span> vs <span style="color:#f8c94c">'+vb+'</span>'+(d!==0?' <span style="color:'+(d>0?'#7de8d8':'#f0a8c8')+'">'+(d>0?'+':'')+d+'</span>':'')+'</span></div>';
  }).join('');

  const closeHandler="document.getElementById('dreamCompareModal').style.display='none';clearCompareSelection()";
  modal.innerHTML='<div style="max-width:520px;margin:0 auto">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div style="font-size:16px;font-weight:900;color:var(--moon)">\uAFC8 \uBE44\uAD50</div><button onclick="'+closeHandler+'" style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer">\u2715</button></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">'
    +'<div style="background:rgba(166,124,239,.06);border:1px solid rgba(166,124,239,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">'+esc(a.date||'')+'</div><div style="font-size:14px;font-weight:700;color:var(--moon)">'+esc(a.title||'')+'</div>'+(a.thumbnail?'<img src="'+a.thumbnail+'" style="width:100%;border-radius:8px;margin-top:8px;max-height:100px;object-fit:cover">':'')+'</div>'
    +'<div style="background:rgba(248,201,76,.06);border:1px solid rgba(248,201,76,.15);border-radius:12px;padding:12px;text-align:center"><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">'+esc(b.date||'')+'</div><div style="font-size:14px;font-weight:700;color:var(--amber)">'+esc(b.title||'')+'</div>'+(b.thumbnail?'<img src="'+b.thumbnail+'" style="width:100%;border-radius:8px;margin-top:8px;max-height:100px;object-fit:cover">':'')+'</div>'
    +'</div>'
    +'<div style="text-align:center;margin-bottom:14px"><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">\uD0A4\uC6CC\uB4DC \uC720\uC0AC\uB3C4</div><div style="font-size:28px;font-weight:900;color:var(--teal)">'+sim+'%</div>'
    +(common.length?'<div style="font-size:10px;color:var(--text-muted);margin-top:4px">\uACF5\uD1B5: '+common.slice(0,5).join(', ')+'</div>':'')
    +'</div>'
    +'<div id="dualRadarContainer" style="text-align:center;margin-bottom:14px"></div>'
    +'<div class="card" style="padding:12px">'+diffHtml+'</div>'
    +'<button onclick="'+closeHandler+'" style="width:100%;margin-top:14px;background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:12px;padding:10px;font-size:12px;color:var(--purple-bright);cursor:pointer">\uB2EB\uAE30</button>'
    +'</div>';

  if(Object.keys(statsA).length&&Object.keys(statsB).length){
    drawDualRadar('dualRadarContainer',statsA,statsB,a.title||'\uAFC8 A',b.title||'\uAFC8 B');
  }
  logEvent('dream_compare_viewed',{similarity:sim});
  trackFunnelStep('retention_action',{action:'dream_compare'});
  var bar=document.getElementById('compareBar');if(bar)bar.remove();
};


window.openMonthlyReport = openMonthlyReport;
window.shareReportImage = shareReportImage;
window.generateDaliWeeklySummary = generateDaliWeeklySummary;

// 알림 설정 UI 동적 삽입
window.renderNotifSettingsUI = function() {
  const resetBtn = document.querySelector('[onclick="resetAllData()"]');
  if (!resetBtn) return;
  let area = document.getElementById('notifSettingsArea');
  if (!area) {
    area = document.createElement('div');
    area.id = 'notifSettingsArea';
    resetBtn.parentElement.insertBefore(area, resetBtn);
  }
  renderNotifSettings(area);
};
try { window.renderNotifSettingsUI(); } catch {}
