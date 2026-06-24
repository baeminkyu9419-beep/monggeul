// 몽글몽글 — MY 탭 월간 보고서 영역
// my.js 의 monthly report 4 함수 분리. 월간 꿈 통계 + GPT 내러티브 + 캔버스 720x1280 이미지 공유.

import { showToast } from '../components/toast.js';
import { logEvent } from '../services/analytics.js';
import { trackFunnelStep } from '../utils/funnel.js';
import { callChat } from '../services/api.js';
import { getCachedTier } from '../services/subscription.js';
import { showPaywall } from '../components/paywall.js';

export function openMonthlyReport(){
  logEvent('monthly_report_opened');
  trackFunnelStep('retention_action',{action:'monthly_report'});
  const page=document.getElementById('reportPage');
  if(!page)return;
  page.classList.add('on');
  renderMonthlyReport();
}

function renderMonthlyReport(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
  const monthLogs=logs.filter(function(l){
    if(!l.date)return false;
    var parts=l.date.replace(/\./g,'').trim().split(/\s+/);
    if(parts.length<3)return false;
    var d=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
    return d>=monthStart;
  });

  const content=document.querySelector('.report-content');
  if(!content)return;

  // 감정 분포
  const emotionCount={};
  monthLogs.forEach(function(l){
    (l.emotions||[]).forEach(function(e){
      var clean=e.replace(/^[^\s]+\s/,'');
      emotionCount[clean]=(emotionCount[clean]||0)+1;
    });
  });
  const topEmotions=Object.entries(emotionCount).sort(function(a,b){return b[1]-a[1];}).slice(0,5);

  // 배지 분포
  const badgeCount={};
  monthLogs.forEach(function(l){
    (l.badges||[]).forEach(function(b){badgeCount[b]=(badgeCount[b]||0)+1;});
  });
  const good=badgeCount['길몽']||0;
  const bad=badgeCount['흉몽']||0;

  // 베스트/워스트 꿈
  var bestDream=null,worstDream=null;
  monthLogs.forEach(function(l){
    var score=(l.stats||{})['길흉']||50;
    if(!bestDream||score>(bestDream.stats||{})['길흉']||0)bestDream=l;
    if(!worstDream||score<(worstDream.stats||{})['길흉']||100)worstDream=l;
  });

  // 키워드
  const kwCount={};
  monthLogs.forEach(function(l){
    (l.text||'').split(/\s+/).forEach(function(w){
      if(w.length>=2)kwCount[w]=(kwCount[w]||0)+1;
    });
  });
  const topKws=Object.entries(kwCount).sort(function(a,b){return b[1]-a[1];}).slice(0,5);

  var monthName=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'][now.getMonth()];
  var esc=function(s){return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  // 성장 리뷰
  var growthMsg='';
  if(monthLogs.length>=10)growthMsg='꾸준히 기록하고 있어요! 무의식과의 대화가 깊어지고 있어요.';
  else if(monthLogs.length>=5)growthMsg='좋은 흐름이에요. 조금 더 꾸준하면 패턴이 더 뚜렷해져요.';
  else growthMsg='이번 달은 기록이 적었어요. 매일 아침 간단히라도 적어보는 건 어때요?';

  var heroEmoji=good>=bad?'🌟':'🌙';
  var heroTitle=monthName+' 꿈 리포트';
  var heroSub=monthLogs.length+'개의 꿈을 분석했어요';

  document.getElementById('reportHeroEmoji').textContent=heroEmoji;
  document.getElementById('reportHeroTitle').textContent=heroTitle;
  document.getElementById('reportHeroSub').textContent=heroSub;
  document.getElementById('rStatDays').textContent=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  document.getElementById('rStatDreams').textContent=monthLogs.length;
  document.getElementById('rStatLuck').textContent=good>=bad?'길':'흉';

  // 감정 바
  var totalEmo=topEmotions.reduce(function(a,e){return a+e[1];},0)||1;
  var emoColors=['#7de8d8','#a67cef','#f8c94c','#f0a8c8','#c8bff8'];
  document.getElementById('reportEmoBars').innerHTML=topEmotions.map(function(e,i){
    var pct=Math.round(e[1]/totalEmo*100);
    return '<div class="emo-bar-row"><span class="emo-bar-label">'+esc(e[0])+'</span><div class="emo-bar-wrap"><div class="emo-bar-fill" style="width:'+pct+'%;background:'+emoColors[i%5]+'"></div></div><span class="emo-bar-pct">'+pct+'%</span></div>';
  }).join('');

  // 달이 내러티브
  var narrative=monthName+' 한 달간 '+monthLogs.length+'개의 꿈을 기록했어요. ';
  if(good>bad)narrative+='길몽이 '+good+'개로 전반적으로 밝은 달이었어요. ';
  else if(bad>good)narrative+='흉몽이 '+bad+'개로 마음이 무거웠을 수 있어요. ';
  if(topKws.length>0)narrative+='"'+topKws[0][0]+'" 키워드가 '+topKws[0][1]+'번 등장했어요. ';
  if(bestDream)narrative+='가장 좋았던 꿈은 "'+esc(bestDream.title||'')+'"이었고, ';
  if(worstDream)narrative+='가장 무거웠던 꿈은 "'+esc(worstDream.title||'')+'"이었어요. ';
  narrative+=growthMsg+' 🌙';
  document.getElementById('reportAiText').innerHTML=narrative;

  // 주/월 전환 라벨
  var lbl=document.getElementById('rwsLabel');
  if(lbl)lbl.textContent=monthName+' 월간 리포트';
}


// ══ GPT 리포트 내러티브 생성 (Phase 2-2) ══
export async function generateGPTNarrative(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const now=new Date();
  const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
  const monthLogs=logs.filter(function(l){
    if(!l.date)return false;
    var parts=l.date.replace(/\./g,'').trim().split(/\s+/);
    if(parts.length<3)return false;
    var d=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
    return d>=monthStart;
  });
  if(monthLogs.length<2){showToast('이번 달 꿈이 2개 이상 있어야 AI 분석을 받을 수 있어요');return;}

  // [구독 게이트] AI 월간 리포트 = Plus 구독 전용. 서버(openai-proxy)가 단일 권위로 403 차단하나,
  //   비구독자에게 정직한 페이월을 먼저 보여줘 '오류'로 위장된 무반응을 피한다(server gate = 우회불가 정본).
  const _tier=getCachedTier();
  if(_tier!=='plus'&&_tier!=='premium'){
    showPaywall('weekly_report');
    return;
  }

  // 요약 데이터 생성
  const badgeCount={};
  monthLogs.forEach(function(l){(l.badges||[]).forEach(function(b){badgeCount[b]=(badgeCount[b]||0)+1;});});
  const kwCount={};
  monthLogs.forEach(function(l){(l.text||'').split(/\s+/).forEach(function(w){if(w.length>=2)kwCount[w]=(kwCount[w]||0)+1;});});
  const topKws=Object.entries(kwCount).sort(function(a,b){return b[1]-a[1];}).slice(0,5).map(function(e){return e[0];});
  const emoCount={};
  monthLogs.forEach(function(l){(l.emotions||[]).forEach(function(e){var c=e.replace(/^[^\s]+\s/,'');emoCount[c]=(emoCount[c]||0)+1;});});
  const topEmos=Object.entries(emoCount).sort(function(a,b){return b[1]-a[1];}).slice(0,3).map(function(e){return e[0];});
  const titles=monthLogs.slice(0,5).map(function(l){return l.title||'';}).filter(Boolean);

  const el=document.getElementById('reportAiText');
  if(el)el.innerHTML='<span style="color:var(--text-muted)">🤖 AI가 분석 중...</span>';

  try{
    // [보안] 프롬프트는 서버(openai-proxy/prompts.ts)에서 task='monthly_report' 로 조립.
    //   클라는 본인 월간 통계 데이터(params)만 전송한다.
    const data=await callChat('monthly_report',{
      count:monthLogs.length,
      good:(badgeCount['길몽']||0),
      bad:(badgeCount['흉몽']||0),
      keywords:topKws,
      emotions:topEmos,
      titles:titles
    });
    const text=data.choices?.[0]?.message?.content||'';
    // [입력 grounding] 서버가 내러티브를 사용자 이번 달 데이터 미반영(일반론) 판정 시 _ungrounded=true.
    //   구독료를 낸 사용자에게 자기 달과 무관한 generic AI 내러티브를 보여주지 않는다 →
    //   데이터-grounded 로컬 템플릿(renderMonthlyReport 가 실제 키워드/제목/감정으로 만든 것)으로 강등.
    if(data._ungrounded||!text){
      renderMonthlyReport();
      logEvent('gpt_narrative_ungrounded',{month:now.getMonth()+1,dreams:monthLogs.length});
    }else if(el){
      el.innerHTML=text.replace(/\n/g,'<br>');
      logEvent('gpt_narrative_generated',{month:now.getMonth()+1,dreams:monthLogs.length});
    }
  }catch(e){
    if(el)el.innerHTML='오프라인이거나 일시적 오류예요. 나중에 다시 시도해보세요.';
  }
}

// ══ 리포트 이미지 공유 (캔버스 렌더링) (Phase 2-2) ══
export async function shareReportImage(){
  logEvent('report_shared');
  var c=document.createElement('canvas');
  c.width=720;c.height=1280;
  var ctx=c.getContext('2d');

  // 배경
  var bg=ctx.createLinearGradient(0,0,0,1280);
  bg.addColorStop(0,'#0e0c1a');bg.addColorStop(0.5,'#1e1840');bg.addColorStop(1,'#13102a');
  ctx.fillStyle=bg;ctx.fillRect(0,0,720,1280);

  // 제목
  ctx.fillStyle='#f5e6b2';ctx.font='bold 32px sans-serif';ctx.textAlign='center';
  var title=document.getElementById('reportHeroTitle')?.textContent||'꿈 리포트';
  ctx.fillText(title,360,80);

  // 이모지
  ctx.font='64px sans-serif';
  ctx.fillText(document.getElementById('reportHeroEmoji')?.textContent||'🌙',360,170);

  // 서브타이틀
  ctx.fillStyle='#a89dd0';ctx.font='18px sans-serif';
  ctx.fillText(document.getElementById('reportHeroSub')?.textContent||'',360,220);

  // 스탯
  ctx.fillStyle='#f0ecff';ctx.font='bold 48px sans-serif';
  var dreams=document.getElementById('rStatDreams')?.textContent||'0';
  ctx.fillText(dreams,360,320);
  ctx.fillStyle='#6b5e8a';ctx.font='14px sans-serif';
  ctx.fillText('꿈 기록',360,350);

  // 달이 내러티브
  ctx.fillStyle='#a89dd0';ctx.font='16px sans-serif';ctx.textAlign='left';
  var aiText=(document.getElementById('reportAiText')?.textContent||'').substring(0,120);
  var words=aiText.split('');
  var lines=[];var line='';
  for(var i=0;i<words.length;i++){
    line+=words[i];
    if(ctx.measureText(line).width>600||words[i]==='.'||words[i]==='!'){
      lines.push(line);line='';
    }
  }
  if(line)lines.push(line);
  lines.slice(0,6).forEach(function(l,i){
    ctx.fillText(l,60,440+i*28);
  });

  // 푸터
  ctx.fillStyle='rgba(200,191,248,.4)';ctx.font='20px sans-serif';ctx.textAlign='center';
  ctx.fillText('🌙 몽글몽글',360,1180);
  ctx.fillStyle='rgba(200,191,248,.25)';ctx.font='14px sans-serif';
  ctx.fillText('나도 꿈 해몽 해보기 👇',360,1210);

  try{
    var blob=await new Promise(function(ok){c.toBlob(ok,'image/png');});
    if(navigator.share&&blob){
      var file=new File([blob],'dream-report.png',{type:'image/png'});
      await navigator.share({title:'몽글몽글 꿈 리포트',files:[file]});
    }else{
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');a.href=url;a.download='dream-report.png';a.click();
      URL.revokeObjectURL(url);
      if(window.showToast)showToast('리포트 이미지가 다운로드됐어요! 📸');
    }
  }catch(e){
    if(window.showToast)showToast('이미지 생성에 실패했어요');
  }
}

// window 글로벌 노출 (inline onclick 호환)
window.generateGPTNarrative=generateGPTNarrative;
