// Patch: Phase 2-2 월간 리포트 + 공유 이미지 + 달이 주간 서머리
const fs = require('fs');
const path = require('path');

const myPath = path.join(__dirname, '..', 'src', 'tabs', 'my.js');
let myCode = fs.readFileSync(myPath, 'utf8');

if (myCode.includes('renderMonthlyReport')) {
  console.log('SKIP: renderMonthlyReport already exists');
  process.exit(0);
}

const funcs = `

// ══ 월간 리포트 (Phase 2-2) ══
export function openMonthlyReport(){
  logEvent('monthly_report_opened');
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
    var parts=l.date.replace(/\\./g,'').trim().split(/\\s+/);
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
      var clean=e.replace(/^[^\\s]+\\s/,'');
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
    (l.text||'').split(/\\s+/).forEach(function(w){
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

// ══ 달이 주간 서머리 자동 생성 (Phase 2-2) ══
export function generateDaliWeeklySummary(){
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length<3)return null;

  const weekLogs=logs.filter(function(l){
    if(!l.date)return false;
    var parts=l.date.replace(/\\./g,'').trim().split(/\\s+/);
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
    (l.text||'').split(/\\s+/).forEach(function(w){
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
}`;

// toggleDictItem 앞에 삽입
const anchor = 'export function toggleDictItem';
const idx = myCode.indexOf(anchor);
if (idx === -1) {
  console.error('ERROR: anchor not found');
  process.exit(1);
}
myCode = myCode.slice(0, idx) + funcs + '\n\n' + myCode.slice(idx);

// window 바인딩 추가
if (!myCode.includes('window.openMonthlyReport')) {
  myCode += '\nwindow.openMonthlyReport = openMonthlyReport;\nwindow.shareReportImage = shareReportImage;\nwindow.generateDaliWeeklySummary = generateDaliWeeklySummary;\n';
}

fs.writeFileSync(myPath, myCode, 'utf8');
console.log('DONE: monthly report + share image + dali weekly summary added');
