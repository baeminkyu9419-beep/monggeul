// 몽글몽글 — MY 탭 감정/상징/수면 영역 (Phase 2 + 2-1)
// my.js L716~1127 분리. internal function → export 로 변환 (5 함수).
// 의존: emotion-chart / symbol-tracker / sleep-checkin components.

import { showToast } from '../components/toast.js';
import { esc } from '../utils/sanitize.js';
import { renderEmotionFlowChart } from '../components/emotion-chart.js';
import { renderSymbolTracker } from '../components/symbol-tracker.js';
import { showSleepCheckin, showMorningCheckin, renderSleepCorrelation } from '../components/sleep-checkin.js';

// ── 감정 흐름 래퍼 (Phase 2) ──
export function renderEmotionFlow(){
  renderEmotionFlowChart('emotionFlowChart', 30);
}

// ── 반복꿈 타임라인 (Phase 2-1) ──
export function renderRecurringTimeline(){
  const el=document.getElementById('recurringTimelineWrap');
  if(!el)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length<3){el.style.display='none';return;}

  // 키워드별 발생일 추적
  const kwDates={};
  const symbols=['뱀','물','불','이빨','하늘','돈','돼지','고양이','달','꽃','비','바다','산','차','집','학교','아기','결혼','시험','죽음'];
  logs.forEach(function(l){
    if(!l.date||!l.text)return;
    symbols.forEach(function(s){
      if(l.text.includes(s)){
        if(!kwDates[s])kwDates[s]=[];
        kwDates[s].push(l.date);
      }
    });
    (l.badges||[]).forEach(function(b){
      if(!kwDates[b])kwDates[b]=[];
      kwDates[b].push(l.date);
    });
  });

  // 2회 이상 등장한 키워드만
  const recurring=Object.entries(kwDates).filter(function(e){return e[1].length>=2;}).sort(function(a,b){return b[1].length-a[1].length;}).slice(0,5);
  if(recurring.length===0){el.style.display='none';return;}

  const colors=['#a67cef','#7de8d8','#f8c94c','#f0a8c8','#c8bff8'];
  const now=new Date();
  const thirtyAgo=new Date(now.getTime()-30*24*60*60*1000);

  let html='<div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:10px">반복 상징 타임라인</div>';
  recurring.forEach(function(entry,ci){
    const kw=entry[0];
    const dates=entry[1];
    const color=colors[ci%colors.length];
    // 30일 타임라인 바
    html+='<div style="margin-bottom:10px">';
    html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
    html+='<span style="font-size:11px;font-weight:600;color:'+color+'">'+kw+'</span>';
    html+='<span style="font-size:9px;color:var(--text-muted)">'+dates.length+'회</span>';
    html+='</div>';
    html+='<div style="position:relative;height:16px;background:rgba(255,255,255,.03);border-radius:8px;overflow:hidden">';
    dates.forEach(function(d){
      // 날짜를 파싱 (한국어 형식 "2026. 4. 7.")
      var parts=d.replace(/\./g,'').trim().split(/\s+/);
      var dateObj;
      if(parts.length>=3){
        dateObj=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
      }else{
        dateObj=new Date(d);
      }
      if(isNaN(dateObj.getTime()))return;
      var diffMs=dateObj.getTime()-thirtyAgo.getTime();
      var totalMs=now.getTime()-thirtyAgo.getTime();
      var pct=Math.max(0,Math.min(100,(diffMs/totalMs)*100));
      html+='<div style="position:absolute;left:'+pct+'%;top:50%;transform:translate(-50%,-50%);width:8px;height:8px;border-radius:50%;background:'+color+';box-shadow:0 0 4px '+color+'40;border:1px solid rgba(255,255,255,.2)" title="'+d+'"></div>';
    });
    html+='</div>';
    html+='</div>';
  });
  // 범례
  html+='<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:4px"><span>30일 전</span><span>오늘</span></div>';

  el.innerHTML=html;
  el.style.display='block';
}



// ── 상징 시간 추적 (Phase 2-1) ──
// 같은 상징이 시간에 따라 어떻게 변했는지 (배지/감정 변화)
export function renderSymbolEvolution(){
  const el=document.getElementById('symbolEvolutionWrap');
  if(!el)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length<3){el.style.display='none';return;}

  // 상징별 등장 기록 수집
  const symbolHistory={};
  const symbols=['뱀','물','불','이빨','하늘','돈','돼지','고양이','달','꽃','비','바다','산','차','집','학교','아기','결혼','시험','죽음','비행기','전쟁','강','호수','숲'];
  logs.forEach(function(l,i){
    if(!l.text)return;
    symbols.forEach(function(s){
      if(l.text.includes(s)){
        if(!symbolHistory[s])symbolHistory[s]=[];
        symbolHistory[s].push({
          date:l.date||'',
          title:l.title||'',
          badges:l.badges||[],
          emotions:l.emotions||[],
          stats:l.stats||{},
          idx:i
        });
      }
    });
  });

  // 2회 이상 등장한 상징만, 최대 4개
  const tracked=Object.entries(symbolHistory)
    .filter(function(e){return e[1].length>=2;})
    .sort(function(a,b){return b[1].length-a[1].length;})
    .slice(0,4);

  if(tracked.length===0){el.style.display='none';return;}

  const esc=function(s){return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  let html='<div style="font-size:12px;font-weight:700;color:var(--purple-bright);margin-bottom:10px">상징 변화 추적</div>';

  tracked.forEach(function(entry){
    const sym=entry[0];
    const records=entry[1];
    html+='<div style="margin-bottom:14px;background:rgba(166,124,239,.04);border:1px solid rgba(166,124,239,.1);border-radius:12px;padding:10px">';
    html+='<div style="font-size:12px;font-weight:700;color:var(--moon);margin-bottom:8px">"'+esc(sym)+'" ('+records.length+'회 등장)</div>';

    // 시간순 변화 표시
    records.slice(0,5).forEach(function(r,ri){
      const isLast=ri===records.length-1||ri===4;
      const badgeHtml=(r.badges||[]).map(function(b){return '<span style="font-size:8px;background:rgba(166,124,239,.12);border-radius:6px;padding:1px 5px;color:var(--star)">'+esc(b)+'</span>';}).join(' ');
      const emotionHtml=(r.emotions||[]).slice(0,2).map(function(e){return '<span style="font-size:8px;color:var(--text-muted)">'+esc(e)+'</span>';}).join(' ');

      // 길흉 변화 표시
      var gScore=r.stats['길흉']||0;
      var gColor=gScore>=60?'var(--teal)':gScore>=40?'var(--amber)':'var(--pink)';

      html+='<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:'+(!isLast?'6':'0')+'px">';
      // 타임라인 점과 선
      html+='<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:12px">';
      html+='<div style="width:8px;height:8px;border-radius:50%;background:'+gColor+';box-shadow:0 0 4px '+gColor+'40;flex-shrink:0"></div>';
      if(!isLast)html+='<div style="width:1px;flex:1;min-height:20px;background:rgba(255,255,255,.08)"></div>';
      html+='</div>';
      // 내용
      html+='<div style="flex:1;min-width:0">';
      html+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
      html+='<span style="font-size:10px;color:var(--text-muted)">'+esc(r.date)+'</span>';
      html+='<span style="font-size:10px;font-weight:600;color:'+gColor+'">길흉 '+gScore+'</span>';
      html+=badgeHtml;
      html+='</div>';
      if(emotionHtml)html+='<div style="margin-top:2px">'+emotionHtml+'</div>';
      html+='</div>';
      html+='</div>';
    });

    // 변화 요약
    if(records.length>=2){
      var first=records[records.length-1];
      var last=records[0];
      var firstG=(first.stats||{})['길흉']||0;
      var lastG=(last.stats||{})['길흉']||0;
      var diff=lastG-firstG;
      var summary='';
      if(diff>15)summary='"'+sym+'" 꿈이 점점 긍정적으로 변하고 있어요';
      else if(diff<-15)summary='"'+sym+'" 꿈이 최근 더 무거워지고 있어요';
      else summary='"'+sym+'" 꿈의 흐름이 비교적 안정적이에요';
      html+='<div style="margin-top:6px;padding:6px 8px;background:rgba(125,232,216,.06);border-radius:8px;font-size:10px;color:var(--text-secondary)">'+summary+'</div>';
    }
    html+='</div>';
  });

  el.innerHTML=html;
  el.style.display='block';
}



// ── 수면 체크인 + 아침 체크인 (Phase 2-1) ──
export function renderSleepCheckin(){
  const el=document.getElementById('sleepCheckinWrap');
  if(!el)return;

  const today=new Date().toISOString().split('T')[0];
  const checkins=JSON.parse(localStorage.getItem('mg_sleep_checkins')||'{}');
  const todayData=checkins[today]||{};
  const hasTodayData=Object.keys(todayData).length>0;

  const esc=function(s){return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  // 체크인 폼 or 오늘 기록 요약
  let html='';
  if(hasTodayData){
    // 오늘 기록 완료 — 요약 표시
    html+='<div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:8px">오늘의 수면 기록</div>';
    html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px">';
    if(todayData.sleepHours)html+='<div style="text-align:center;padding:8px;background:rgba(125,232,216,.06);border-radius:10px"><div style="font-size:16px;font-weight:900;color:var(--teal)">'+todayData.sleepHours+'h</div><div style="font-size:9px;color:var(--text-muted)">수면</div></div>';
    if(todayData.satisfaction)html+='<div style="text-align:center;padding:8px;background:rgba(248,201,76,.06);border-radius:10px"><div style="font-size:16px;font-weight:900;color:var(--amber)">'+['','😴','😐','🙂','😊','🤩'][todayData.satisfaction]+'</div><div style="font-size:9px;color:var(--text-muted)">만족도</div></div>';
    if(todayData.vividness)html+='<div style="text-align:center;padding:8px;background:rgba(166,124,239,.06);border-radius:10px"><div style="font-size:16px;font-weight:900;color:var(--purple-bright)">'+todayData.vividness+'/5</div><div style="font-size:9px;color:var(--text-muted)">선명도</div></div>';
    html+='</div>';
    var tags=[];
    if(todayData.caffeine)tags.push('☕ 카페인');
    if(todayData.exercise)tags.push('🏃 운동');
    if(todayData.stress)tags.push('😰 스트레스 '+todayData.stress);
    if(tags.length)html+='<div style="display:flex;gap:4px;flex-wrap:wrap">'+tags.map(function(t){return '<span style="font-size:9px;background:rgba(255,255,255,.05);border-radius:8px;padding:2px 6px;color:var(--text-muted)">'+t+'</span>';}).join('')+'</div>';
    html+='<button onclick="window._resetSleepCheckin()" style="margin-top:8px;background:none;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:4px 10px;font-size:9px;color:var(--text-muted);cursor:pointer">다시 기록하기</button>';
  }else{
    // 체크인 폼
    html+='<div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:8px">수면 체크인</div>';
    html+='<div style="font-size:10px;color:var(--text-muted);margin-bottom:10px">오늘의 수면 상태를 기록하면 꿈과의 연관성을 분석해줘요</div>';

    // 수면 시간
    html+='<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px">수면 시간</div>';
    html+='<div style="display:flex;gap:4px;flex-wrap:wrap" id="sleepHoursRow">';
    [4,5,6,7,8,9,10].forEach(function(h){
      html+='<button class="sleep-opt" data-field="sleepHours" data-val="'+h+'" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(125,232,216,.15);background:rgba(125,232,216,.05);color:var(--teal);font-size:11px;cursor:pointer">'+h+'h</button>';
    });
    html+='</div></div>';

    // 수면 만족도 (1-5)
    html+='<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px">수면 만족도</div>';
    html+='<div style="display:flex;gap:6px" id="sleepSatRow">';
    [{v:1,e:'😴'},{v:2,e:'😐'},{v:3,e:'🙂'},{v:4,e:'😊'},{v:5,e:'🤩'}].forEach(function(o){
      html+='<button class="sleep-opt" data-field="satisfaction" data-val="'+o.v+'" style="padding:4px 8px;border-radius:8px;border:1px solid rgba(248,201,76,.15);background:rgba(248,201,76,.05);font-size:16px;cursor:pointer">'+o.e+'</button>';
    });
    html+='</div></div>';

    // 꿈 선명도 (1-5)
    html+='<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px">꿈 기억 선명도</div>';
    html+='<div style="display:flex;gap:4px" id="sleepVivRow">';
    [1,2,3,4,5].forEach(function(v){
      html+='<button class="sleep-opt" data-field="vividness" data-val="'+v+'" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(166,124,239,.15);background:rgba(166,124,239,.05);color:var(--purple-bright);font-size:11px;cursor:pointer">'+v+'</button>';
    });
    html+='</div></div>';

    // 카페인/운동/스트레스
    html+='<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px">어제 상태</div>';
    html+='<div style="display:flex;gap:4px;flex-wrap:wrap">';
    html+='<button class="sleep-opt sleep-toggle" data-field="caffeine" data-val="1" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:var(--text-secondary);font-size:10px;cursor:pointer">☕ 카페인</button>';
    html+='<button class="sleep-opt sleep-toggle" data-field="exercise" data-val="1" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:var(--text-secondary);font-size:10px;cursor:pointer">🏃 운동</button>';
    html+='</div></div>';
    html+='<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px">스트레스 수준</div>';
    html+='<div style="display:flex;gap:4px" id="sleepStressRow">';
    [{v:'low',t:'😌 낮음'},{v:'mid',t:'😐 보통'},{v:'high',t:'😰 높음'}].forEach(function(o){
      html+='<button class="sleep-opt" data-field="stress" data-val="'+o.v+'" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:var(--text-secondary);font-size:10px;cursor:pointer">'+o.t+'</button>';
    });
    html+='</div></div>';

    html+='<button onclick="window._saveSleepCheckin()" style="width:100%;padding:8px;border-radius:10px;border:none;background:rgba(125,232,216,.15);color:var(--teal);font-size:12px;font-weight:700;cursor:pointer">기록 저장</button>';
  }

  el.innerHTML=html;
  el.style.display='block';

  // 선택 이벤트 바인딩
  if(!hasTodayData){
    el.querySelectorAll('.sleep-opt:not(.sleep-toggle)').forEach(function(btn){
      btn.addEventListener('click',function(){
        var field=this.dataset.field;
        this.parentElement.querySelectorAll('.sleep-opt').forEach(function(b){b.style.borderColor='rgba(255,255,255,.1)';b.style.background='rgba(255,255,255,.03)';});
        this.style.borderColor='var(--teal)';
        this.style.background='rgba(125,232,216,.15)';
        this.dataset.selected='1';
      });
    });
    el.querySelectorAll('.sleep-toggle').forEach(function(btn){
      btn.addEventListener('click',function(){
        var on=this.dataset.selected==='1';
        this.dataset.selected=on?'0':'1';
        this.style.borderColor=on?'rgba(255,255,255,.1)':'var(--amber)';
        this.style.background=on?'rgba(255,255,255,.03)':'rgba(248,201,76,.1)';
      });
    });
  }
}

window._saveSleepCheckin=function(){
  var el=document.getElementById('sleepCheckinWrap');
  if(!el)return;
  var data={};
  el.querySelectorAll('.sleep-opt[data-selected="1"]').forEach(function(btn){
    var field=btn.dataset.field;
    var val=btn.dataset.val;
    if(field==='caffeine'||field==='exercise')data[field]=true;
    else if(field==='satisfaction'||field==='vividness'||field==='sleepHours')data[field]=parseInt(val);
    else data[field]=val;
  });
  if(Object.keys(data).length===0){window.showToast&&showToast('하나 이상 선택해주세요');return;}
  var today=new Date().toISOString().split('T')[0];
  var checkins=JSON.parse(localStorage.getItem('mg_sleep_checkins')||'{}');
  checkins[today]=data;
  localStorage.setItem('mg_sleep_checkins',JSON.stringify(checkins));
  if(window.logEvent)logEvent('sleep_checkin_saved',data);
  trackFunnelStep('retention_action',{action:'sleep_checkin'});
  renderSleepCheckin();
  if(window.showToast)showToast('수면 기록 저장 완료! 🌙');
};

window._resetSleepCheckin=function(){
  var today=new Date().toISOString().split('T')[0];
  var checkins=JSON.parse(localStorage.getItem('mg_sleep_checkins')||'{}');
  delete checkins[today];
  localStorage.setItem('mg_sleep_checkins',JSON.stringify(checkins));
  renderSleepCheckin();
};



// ── 수면 품질 <-> 꿈 감정 상관관계 (Phase 2-1) ──
export function renderSleepDreamCorrelation(){
  const el=document.getElementById('sleepCorrelationWrap');
  if(!el)return;
  const checkins=JSON.parse(localStorage.getItem('mg_sleep_checkins')||'{}');
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');

  // 체크인 날짜와 같은 날 꿈 기록 매칭
  const pairs=[];
  Object.entries(checkins).forEach(function(entry){
    const date=entry[0];
    const sleep=entry[1];
    // 해당 날짜 꿈 찾기 (한국어 날짜 형식 매칭)
    const matchDream=logs.find(function(l){
      if(!l.date)return false;
      var parts=l.date.replace(/\./g,'').trim().split(/\s+/);
      if(parts.length>=3){
        var d=parts[0]+'-'+(parts[1].length===1?'0':'')+parts[1]+'-'+(parts[2].length===1?'0':'')+parts[2];
        return d===date;
      }
      return false;
    });
    if(matchDream&&matchDream.stats){
      pairs.push({sleep:sleep,dream:matchDream});
    }
  });

  if(pairs.length<2){el.style.display='none';return;}

  const esc=function(s){return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  // SVG 산점도 생성
  const W=280,H=160,pad=30;
  const plotW=W-pad*2,plotH=H-pad*2;

  let svg='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="max-width:100%">';
  // 축
  svg+='<line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="rgba(255,255,255,.1)" stroke-width="0.5"/>';
  svg+='<line x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(H-pad)+'" stroke="rgba(255,255,255,.1)" stroke-width="0.5"/>';
  // 축 레이블
  svg+='<text x="'+(W/2)+'" y="'+(H-5)+'" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="Noto Sans KR">수면 만족도</text>';
  svg+='<text x="8" y="'+(H/2)+'" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="Noto Sans KR" transform="rotate(-90,8,'+(H/2)+')">길흉 점수</text>';

  // 데이터 점 그리기
  pairs.forEach(function(p){
    var sat=p.sleep.satisfaction||3;
    var score=(p.dream.stats||{})['길흉']||50;
    var x=pad+(sat-1)/4*plotW;
    var y=(H-pad)-(score/100)*plotH;
    var isGood=(p.dream.badges||[]).includes('길몽');
    var color=isGood?'#7de8d8':'#f0a8c8';
    svg+='<circle cx="'+x+'" cy="'+y+'" r="5" fill="'+color+'" opacity="0.7"><title>만족도: '+sat+', 길흉: '+score+'</title></circle>';
  });

  // 눈금
  for(var i=1;i<=5;i++){
    var tx=pad+(i-1)/4*plotW;
    svg+='<text x="'+tx+'" y="'+(H-pad+12)+'" text-anchor="middle" font-size="8" fill="var(--text-muted)">'+i+'</text>';
  }
  for(var j=0;j<=100;j+=25){
    var ty=(H-pad)-(j/100)*plotH;
    svg+='<text x="'+(pad-4)+'" y="'+(ty+3)+'" text-anchor="end" font-size="8" fill="var(--text-muted)">'+j+'</text>';
  }
  svg+='</svg>';

  // 상관관계 분석
  var satVals=pairs.map(function(p){return p.sleep.satisfaction||3;});
  var scoreVals=pairs.map(function(p){return (p.dream.stats||{})['길흉']||50;});
  var avgSat=satVals.reduce(function(a,b){return a+b;},0)/satVals.length;
  var avgScore=scoreVals.reduce(function(a,b){return a+b;},0)/scoreVals.length;
  var cov=0,varSat=0,varScore=0;
  for(var k=0;k<pairs.length;k++){
    var ds=satVals[k]-avgSat;
    var dsc=scoreVals[k]-avgScore;
    cov+=ds*dsc;
    varSat+=ds*ds;
    varScore+=dsc*dsc;
  }
  var corr=(varSat>0&&varScore>0)?cov/Math.sqrt(varSat*varScore):0;
  var corrText='';
  if(corr>0.3)corrText='수면 만족도가 높을수록 긍정적인 꿈을 꾸는 경향이 있어요';
  else if(corr<-0.3)corrText='수면 만족도와 꿈 분위기가 반대로 움직이는 흥미로운 패턴이에요';
  else corrText='아직 뚜렷한 패턴이 보이지 않아요. 기록을 더 쌓아보세요';

  // 카페인/운동 영향
  var cafPairs=pairs.filter(function(p){return p.sleep.caffeine;});
  var noCafPairs=pairs.filter(function(p){return !p.sleep.caffeine;});
  var cafNote='';
  if(cafPairs.length>=2&&noCafPairs.length>=2){
    var cafAvg=cafPairs.reduce(function(a,p){return a+((p.dream.stats||{})['길흉']||50);},0)/cafPairs.length;
    var noCafAvg=noCafPairs.reduce(function(a,p){return a+((p.dream.stats||{})['길흉']||50);},0)/noCafPairs.length;
    if(noCafAvg-cafAvg>10)cafNote='카페인 섭취 후 꿈의 길흉 점수가 낮아지는 경향이 있어요';
    else if(cafAvg-noCafAvg>10)cafNote='카페인이 꿈에 특별히 부정적인 영향을 주지 않는 것 같아요';
  }

  el.innerHTML='<div style="font-size:12px;font-weight:700;color:var(--amber);margin-bottom:8px">수면 & 꿈 상관관계</div>'
    +'<div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">'+pairs.length+'일 데이터 기반</div>'
    +svg
    +'<div style="display:flex;justify-content:center;gap:12px;margin-top:6px;font-size:9px;color:var(--text-muted)">'
    +'<span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:50%;background:#7de8d8;display:inline-block"></span>길몽</span>'
    +'<span style="display:flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:50%;background:#f0a8c8;display:inline-block"></span>흉몽</span>'
    +'</div>'
    +'<div style="margin-top:8px;padding:8px;background:rgba(248,201,76,.06);border-radius:8px;font-size:10px;color:var(--text-secondary);line-height:1.5">'
    +corrText
    +(cafNote?'<br>'+cafNote:'')
    +'</div>';
  el.style.display='block';
}


