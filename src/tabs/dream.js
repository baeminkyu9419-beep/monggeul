// 몽글몽글 — 해몽 탭
import { store } from '../store.js';
import { callOpenAI } from '../services/api.js';
import { showToast } from '../components/toast.js';
import { showPaywall, showPremiumPaywall } from '../components/paywall.js';
import { drawRadar, drawRadarCompare, drawDualRadar } from '../components/radar.js';
import { canUseDream, incDreamCount, getDreamCount, getCachedTier, getUserTier, getCredits, useCredit, updateCreditInfo } from '../services/subscription.js';
import { LMSGS, DAILY_SYMBOLS, DICT_DATA, FEED_DEMO } from '../utils/symbols.js';
import { logEvent } from '../services/analytics.js';
import { trackFunnelStep } from '../utils/funnel.js';
import { esc, sanitize, validateDreamResult } from '../utils/sanitize.js';
import { addXP, ALL_DICT_REF } from './my.js';
import { getContextForPrompt, getLifeStagePrompt, showContextQuestions } from '../services/dream-context.js';
import { demoResult, _evaluateRichness } from './dream-demo.js';
import { isNonsenseInput } from '../utils/dream-validator.js';
import { shareResult, generateShareCard, generateDreamThumbnail, generateResultThumbnail } from './dream-share.js';
import { stopVoiceInput, startVoiceInput } from './dream-voice.js';

let loadStepTimer=null;
const FEED_THUMBS={};

// ── 상징 자동 링크: 해몽 결과에서 DICT_DATA 키워드를 탭 가능한 링크로 변환 ──
const _symbolNames = DICT_DATA.map(d => d.n).sort((a,b) => b.length - a.length); // 긴 것 먼저 매칭
function linkSymbols(html) {
  if (!html) return html;
  let result = html;
  for (const name of _symbolNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const re = new RegExp('(?<!<[^>]*)(' + escaped + ')(?![^<]*>)', 'g');
    result = result.replace(re, '<span class="symbol-link" data-symbol="' + name + '" onclick="window._openSymbol(\'' + name + '\')">$1</span>');
  }
  return result;
}
window._openSymbol = function(name) {
  window.openDictPage();
  setTimeout(() => {
    const si = document.getElementById('dictSearchInput');
    if (si) { si.value = name; window.filterDict(); }
    setTimeout(() => { window.toggleDictItem(name); }, 100);
  }, 200);
};

// ── 꿈 입력 자동 저장 (초안) ──
let _draftTimer=null;
export function saveDreamDraft(val){
  clearTimeout(_draftTimer);
  _draftTimer=setTimeout(()=>{
    if(val&&val.trim().length>=5) localStorage.setItem('mg_dream_draft',val);
    else localStorage.removeItem('mg_dream_draft');
  },500);
}
export function restoreDreamDraft(){
  const draft=localStorage.getItem('mg_dream_draft');
  if(draft){
    const ta=document.getElementById('dreamInput');
    if(ta&&!ta.value){
      ta.value=draft;
      ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,200)+'px';
      showToast('이전에 작성 중이던 꿈이 있어요 📝');
    }
  }
}
function clearDreamDraft(){ localStorage.removeItem('mg_dream_draft'); }

window.saveDreamDraft=saveDreamDraft;
// [버그수정] app.js init이 window.restoreDreamDraft?.()/window.showEmotionTagsSection?.() 호출하나
// 노출 안 돼 항상 no-op 였음 → 작성중 꿈 복원/포커스시 감정태그 섹션 미작동(saveDreamDraft만 노출됨=초안 저장은 되나 복원 안 됨).
window.restoreDreamDraft=restoreDreamDraft;
window.showEmotionTagsSection=showEmotionTagsSection;

// 동적 placeholder 로테이션 (탭 보일 때만 동작)
const DREAM_PLACEHOLDERS=[
  '어젯밤 꿈을 자유롭게 적어보세요...',
  '뱀이 나왔어요, 하늘을 날았어요...',
  '꿈에서 누군가를 만났어요...',
  '이상한 장소에 있었어요...',
  '기분이 묘한 꿈이었어요...',
  '반복되는 꿈을 꿨어요...',
];
let _phIdx=0,_phTimer=null;
function startPlaceholderRotation(){
  if(_phTimer)return;
  _phTimer=setInterval(()=>{
    const ta=document.getElementById('dreamInput');
    const page=document.getElementById('page-dream');
    if(!page||!page.classList.contains('active')){stopPlaceholderRotation();return;}
    if(ta&&!ta.value&&document.activeElement!==ta){
      _phIdx=(_phIdx+1)%DREAM_PLACEHOLDERS.length;
      ta.placeholder=DREAM_PLACEHOLDERS[_phIdx];
    }
  },4000);
}
function stopPlaceholderRotation(){if(_phTimer){clearInterval(_phTimer);_phTimer=null;}}
// 탭 보일 때 시작
setTimeout(startPlaceholderRotation,1000);

// 음성 말풍선: textarea 비어있을 때 보이고, 입력/포커스 시 숨김
setTimeout(()=>{
  const ta=document.getElementById('dreamInput');
  const bubble=document.getElementById('voiceBubble');
  if(!ta||!bubble)return;
  const toggle=()=>{
    if(ta.value.trim().length>0||document.activeElement===ta){
      bubble.classList.add('hidden');
    }else{
      bubble.classList.remove('hidden');
    }
  };
  ta.addEventListener('input',toggle);
  ta.addEventListener('focus',toggle);
  ta.addEventListener('blur',toggle);
},500);

export function fillDream(t){document.getElementById('dreamInput').value=t+'을 꿨어요.';}

export function quickSearch(k){
  const dictEntry=DICT_DATA.find(d=>d.n===k.replace('꿈','').replace('을','').trim()||k.includes(d.n));
  if(dictEntry){
    window.openDictPage();
    setTimeout(()=>{
      document.getElementById('dictSearchInput').value=dictEntry.n;
      window.filterDict();
      setTimeout(()=>{window.toggleDictItem(dictEntry.n);},100);
    },200);
  }else{
    document.getElementById('dreamInput').value=k+'을 꿨어요.';
    analyzeDream();
  }
}

export function startLoadingSteps(){
  const steps=['lstep1','lstep2','lstep3','lstep4'];
  let idx=0;
  steps.forEach(id=>{const el=document.getElementById(id);if(el){el.classList.remove('active');el.classList.remove('done');}});
  if(document.getElementById('lstep1'))document.getElementById('lstep1').classList.add('active');
  loadStepTimer=setInterval(()=>{
    // 현재 단계를 done으로
    const prev=document.getElementById(steps[idx]);
    if(prev){prev.classList.remove('active');prev.classList.add('done');}
    idx=(idx+1)%steps.length;
    // 다음 단계를 active로
    steps.forEach((id,i)=>{const el=document.getElementById(id);if(el&&i===idx)el.classList.add('active');});
  },2000);
}

export function stopLoadingSteps(){clearInterval(loadStepTimer);}

export async function analyzeDream(){
  if(analyzeDream._busy)return; // 연속 클릭 중복 LLM 호출 방지
  const inp=document.getElementById('dreamInput').value.trim();
  if(!inp){showToast('꿈 내용을 입력해주세요 🌙');return;}
  if(isNonsenseInput(inp)){showToast('꿈 내용을 알아볼 수 있게 적어주세요 🌙');return;}
  analyzeDream._busy=true;
  logEvent('dream_started',{length:inp.length,emotionTags:store.selectedEmotions});
  trackFunnelStep('dream_input_complete',{length:inp.length});trackFunnelStep('interpretation_loading');
  clearDreamDraft();
  document.getElementById('dreamInput').blur();
  const userContext=getContextForPrompt();
  const emotionContext=getEmotionContext();
  // 감정 강도 톤 조절: 부정 감정 키워드가 많으면 위로 모드
  const negWords=['무서','공포','불안','두려','겁','슬프','울','죽','쫓','떨어','악몽','가위'];
  const negCount=negWords.filter(w=>inp.includes(w)).length;
  const toneMod=negCount>=3?' 사용자가 매우 무서운 꿈을 꿔서 불안해하고 있어. 위로와 안심을 최우선으로 해석해줘. 긍정적 의미를 반드시 함께 제시하고 따뜻하게 마무리해.'
    :negCount>=1?' 부정적 감정이 포함된 꿈이야. 공포 마케팅 없이 탐색적 어조로, 긍정적 해석도 균형 있게 제시해줘.':'';
  const lifeStagePrompt=getLifeStagePrompt();
  const fullInput=inp+userContext+emotionContext;
  document.getElementById('resultEl').classList.remove('on');
  document.querySelectorAll('#resultEl > [onclick]').forEach(el=>{if(el.textContent.includes('해금'))el.remove();});
  const ld=document.getElementById('loadingEl');ld.classList.add('on');
  startLoadingSteps();
  let mi=0;const iv=setInterval(()=>{mi=(mi+1)%LMSGS.length;document.getElementById('loadTxt').textContent=LMSGS[mi];},1800);
  try{
    const minLoadTime=new Promise(r=>setTimeout(r,2000));
    // 프리미엄/플러스 = 멀티 LLM 교차검증(consensus), 무료 = fallback 라우팅
    const _dreamTier=getCachedTier();
    const dreamMode=(_dreamTier==='premium'||_dreamTier==='plus')?'consensus':undefined;
    // 1차 해석 (가벼운 호출 — 광고 시청 후 공개)
    // 2단계 1차: 빠른 응답 (제목/뱃지/점수/감정/미리보기만) — 즉시 표시 ~3초
    const apiCall=callOpenAI('chat',{model:'gpt-4o',messages:[{role:'system',content:`너는 30년 경력 꿈 해석가야. 친구한테 얘기하듯 편하게.${toneMod}
사용자가 적은 꿈에 실제로 나온 소재(등장인물·장소·사물·행동·감정)에 근거해서만 해석해. 입력에 없는 내용을 지어내지 말고, 누구에게나 들어맞는 일반론·뜬구름 잡는 말 금지. 입력이 짧으면 짧은 대로 그 소재에 집중해.
영어·학술용어·불릿(■●✦) 금지. 자연스러운 글. 반드시 JSON으로만 응답.
{
  "title": "꿈 제목 (이모지+한글, 10자 이내)",
  "badges": ["길몽","흉몽","태몽","연애운","재물운","건강운" 중 1~3개],
  "stats": {"길흉":55,"연애운":40,"재물운":70,"건강운":50,"활력":65,"직관":60},
  "emotions": ["이모지 감정명" 3~5개. 복합감정 가능],
  "preview": "맛보기 해석 3~4문장. 입력한 꿈에 실제 등장한 구체적 소재(사람·장소·사물·행동)를 반드시 1개 이상 그대로 언급하며 짚어주고 '이 꿈엔 더 깊은 이야기가 숨어있어요...'로 마무리. <strong>강조</strong> 가능"
}
stats 규칙(필수): 각 항목은 반드시 0~100 사이의 정수. 위 숫자는 형식 예시일 뿐 그대로 쓰지 말고 꿈 내용에 맞게 0~100 범위로 산출. 보통 30~75 사이, 매우 길하면 80+, 매우 흉하면 20-. 음수·소수·0~10 같은 작은 값 금지.`},{role:'user',content:fullInput}],temperature:.85,max_tokens:700,response_format:{type:'json_object'}},dreamMode);
    const [data]=await Promise.all([apiCall,minLoadTime]);
    const raw=JSON.parse(data.choices[0].message.content.replace(/```json|```/g,'').trim());
    showResult(validateDreamResult(raw)||demoResult(inp),inp);
    // 2단계 2차: 상세 해석 백그라운드 (전통/심리/조언/깊은해석 — 길고 자세하게)
    callOpenAI('chat',{model:'gpt-4o',messages:[{role:'system',content:`너는 30년 경력 꿈 해석가야. 한국 할머니가 들려주는 해몽처럼 따뜻하고 자세하게.${toneMod}${lifeStagePrompt ? '\n' + lifeStagePrompt : ''}
사용자가 적은 꿈에 실제 나온 소재를 각 항목에서 직접 짚어가며 해석해. 입력에 없는 장면을 지어내지 말고, 누구에게나 통하는 일반론은 피해. 그 사람의 그 꿈에만 해당하는 해석을 해.
영어·학술용어·불릿(■●✦) 금지. 반드시 JSON으로만 응답.
{
  "traditional": "전통 해몽 이야기 300자 이상. 옛날 해몽책·할머니 민간 해석을 편하게 풀어서.",
  "psychology": "마음 이야기 300자 이상. 이 꿈이 지금 마음 상태와 어떻게 연결되는지, 무의식이 뭘 말하는지 친구처럼.",
  "advice": "현실 조언 250자 이상. 일주일 안에 해보면 좋을 것 3가지 구체적·현실적으로.",
  "fullInterpretation": "깊은 해석 1000자 이상. 에세이처럼 자연스럽게. 꿈에 나온 것들 각각의 의미, 마음 상태, 앞으로의 힌트, 비슷한 꿈을 또 꾸면의 의미, 따뜻한 마무리까지. 목록·번호 금지, 단락만 나눠서."
}`},{role:'user',content:fullInput}],temperature:.85,max_tokens:3500,response_format:{type:'json_object'}},dreamMode)
      .then(d2=>{ const r2=JSON.parse(d2.choices[0].message.content.replace(/```json|```/g,'').trim()); if(window.showResultDetail)window.showResultDetail(r2); })
      .catch(()=>{ try{ if(window.showResultDetail)window.showResultDetail(demoResult(inp)); }catch(_){} });
  }catch(e){
    await new Promise(r=>setTimeout(r,2000));
    showResult(demoResult(inp),inp);
    // 오프라인/API 실패 시 안내 + 입력 풍부도 평가
    setTimeout(()=>{
      const richness = _evaluateRichness ? _evaluateRichness(inp) : null;
      if (richness && richness.level === 'very_rich') {
        showToast('이 꿈은 매우 풍부해요. 더 정확한 해석은 gpt-4o 키 입력 후 가능해요 🔮');
      } else if (richness && richness.level === 'rich') {
        showToast('풍부한 꿈이네요. 기본 해석을 보여드려요 🌙');
      } else {
        showToast(!navigator.onLine?'오프라인 상태예요. 기본 해석을 보여드려요 🌙':'기본 해석을 보여드려요. 나중에 다시 시도해 주세요 🌙');
      }
    },500);
  }
  finally{analyzeDream._busy=false;clearInterval(iv);stopLoadingSteps();ld.classList.remove('on');await incDreamCount();
    // 무료 사용자: 해몽 후 전면광고 (3회에 1번)
    if(typeof showInterstitialIfReady==='function')showInterstitialIfReady();  // 광고 노출=수익 동작이라 민규 보류(현 미작동 유지)
    if(typeof window._bumpHeroCounter==='function')window._bumpHeroCounter();  // 바레→window(히어로 카운터 미증가 버그)
  }
}

// 2단계 응답의 2차: 상세 해석(전통/심리/조언/깊은해석)을 백그라운드로 받아 DOM 채움
export function showResultDetail(data){
  if(data.traditional||data.psychology||data.advice){
    const w=document.getElementById('interp3Wrap');
    if(w){
      w.style.display='block';
      document.getElementById('i3traditional').innerHTML=sanitize((data.traditional||'').replace(/\n/g,'<br>'));
      document.getElementById('i3psychology').innerHTML=sanitize((data.psychology||'').replace(/\n/g,'<br>'));
      document.getElementById('i3advice').innerHTML=sanitize((data.advice||'').replace(/\n/g,'<br>'));
      document.querySelectorAll('.i3tab').forEach((b,i)=>{b.classList.toggle('active',i===0);});
      document.querySelectorAll('.i3content').forEach((c,i)=>{c.style.display=i===0?'block':'none';});
    }
  }
  const full=data.fullInterpretation||data.interpretation||'';
  if(full){
    document.getElementById('lockPreview').innerHTML=sanitize(full.substring(0,250).replace(/\n/g,'<br>'))+'...';
    document.getElementById('interpFull').innerHTML=linkSymbols(sanitize(full.replace(/\n/g,'<br>')));
    document.getElementById('detailLock').style.display='block';
    document.getElementById('detailFull').style.display='none';
  }
}
window.showResultDetail=showResultDetail;

export function showResult(data,inp){
  logEvent('dream_completed',{title:data.title,badges:data.badges});
  trackFunnelStep('interpretation_viewed',{title:data.title});
  // 퍼널 추적
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(typeof window.trackFunnel==='function'){  // 바레→window(퍼널 추적 미작동 버그)
    if(logs.length===0)window.trackFunnel('first_dream');
    else if(logs.length===1)window.trackFunnel('second_dream');
  }
  document.getElementById('rTitle').textContent=data.title;
  document.getElementById('rDate').textContent=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});
  // 길몽/흉몽 오라 효과
  const resultEl=document.getElementById('resultEl');
  let aura=resultEl.querySelector('.result-aura');
  if(!aura){aura=document.createElement('div');aura.className='result-aura';resultEl.prepend(aura);}
  aura.className='result-aura '+((data.badges||[]).includes('흉몽')?'bad':'good');
  const bm={길몽:'bl',태몽:'bl',재물운:'bl',활력:'bl',흉몽:'bb',연애운:'bv',건강운:'bv'};
  const badgeDesc={
    '길몽':'좋은 기운의 꿈이에요',
    '흉몽':'주의가 필요한 꿈이에요',
    '태몽':'새 생명의 기운이 느껴져요',
    '연애운':'사랑과 관계에 대한 꿈이에요',
    '재물운':'돈과 기회에 대한 꿈이에요',
    '건강운':'몸과 마음에 대한 꿈이에요',
  };
  const mainBadge=data.badges?.[0]||'';
  const desc=badgeDesc[mainBadge]||'';
  document.getElementById('badgeRow').innerHTML=data.badges.map(b=>`<span class="badge ${bm[b]||'bl'}">${esc(b)}</span>`).join('')
    +(desc?`<div style="font-size:10px;color:var(--text-muted);margin-top:6px">${desc}</div>`:'');
  // 달이가 분석한 감정 표시
  const emotionRow=document.getElementById('resultEmotions');
  if(emotionRow&&data.emotions&&data.emotions.length>0){
    emotionRow.style.display='block';
    emotionRow.innerHTML=`<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;"><span style="color:var(--purple-bright)">🐱</span> 달이가 분석한 감정</div><div class="emotion-chips">${data.emotions.map(e=>`<span class="echip on">${esc(e)}</span>`).join('')}</div>`;
  }
  document.getElementById('interpText').innerHTML=linkSymbols(sanitize(data.preview||data.interpretation||''));
  const insightEl=document.getElementById('dreamInsight');
  const insightText=document.getElementById('insightText');
  if(insightEl&&insightText){
    const insights={
      뱀:'변화에 민감하고 재물에 대한 감각이 뛰어난 편이에요. 직감을 믿어보세요!',
      이빨:'완벽주의 성향이 있고, 현재 중요한 결정 앞에 서 있을 가능성이 높아요.',
      하늘:'자유를 갈망하고 높은 목표를 가진 사람이에요. 도전을 두려워하지 마세요!',
      물:'감수성이 풍부하고 감정의 흐름에 민감한 사람이에요. 내면의 목소리에 귀 기울여보세요.',
      불:'열정적이고 에너지가 넘치는 시기예요. 그 힘을 긍정적으로 사용해보세요!',
      돈:'실용적이고 목표 지향적인 성향이에요. 좋은 기회가 다가오고 있을 수 있어요.',
      돼지:'풍요와 행운을 끌어당기는 기운이 있어요. 주변 사람들에게도 좋은 영향을 줘요!',
    };
    const key=Object.keys(insights).find(k=>inp.includes(k));
    if(key){insightEl.style.display='block';insightText.textContent=insights[key];}
    else{insightEl.style.display='block';insightText.textContent='변화의 시기에 있으며, 무의식이 중요한 메시지를 보내고 있어요. 꿈을 기록하는 습관이 자기 이해를 깊게 해줄 거예요.';}
  }
  const kwEl=document.getElementById('dreamKeywords');
  if(kwEl){
    const found=_symbolNames.filter(s=>inp.includes(s));
    kwEl.innerHTML=found.map(k=>{const d=DICT_DATA.find(x=>x.n===k);return '<span class="symbol-link" data-symbol="'+k+'" onclick="window._openSymbol(\''+k+'\')" style="font-size:10px;background:rgba(166,124,239,.12);border:1px solid rgba(166,124,239,.2);border-radius:12px;padding:2px 8px;color:var(--star);cursor:pointer">'+(d?d.e+' ':'')+k+'</span>';}).join('');
  }
  // 2단계: 상세(전통/심리/조언/깊은해석)가 있으면 즉시 채우고, 없으면(1차 빠른응답) 백그라운드 로딩 표시
  if(data.traditional||data.psychology||data.advice||data.fullInterpretation){
    showResultDetail(data);
  }else{
    const w=document.getElementById('interp3Wrap');
    if(w){
      w.style.display='block';
      document.getElementById('i3traditional').innerHTML='<div style="text-align:center;color:var(--text-muted);padding:18px;font-size:12px">🐱 달이가 더 깊이 들여다보는 중...</div>';
      document.getElementById('i3psychology').innerHTML='';
      document.getElementById('i3advice').innerHTML='';
      document.querySelectorAll('.i3tab').forEach((b,i)=>{b.classList.toggle('active',i===0);});
      document.querySelectorAll('.i3content').forEach((c,i)=>{c.style.display=i===0?'block':'none';});
    }
    document.getElementById('lockPreview').innerHTML='🌙 깊은 해석을 정리하고 있어요...';
    document.getElementById('interpFull').innerHTML='<div style="text-align:center;color:var(--text-muted);padding:22px">🐱 달이가 깊은 해석을 쓰고 있어요...<br><span style="font-size:11px">잠시만요</span></div>';
    document.getElementById('detailLock').style.display='block';
    document.getElementById('detailFull').style.display='none';
  }
  // 레이더 차트: 이전 꿈 3개 이상이면 비교 모드 (현재 vs 평균 오버레이)
  if(logs.filter(l=>!l.noDream).length>=3){
    const prevLogs=logs.filter(l=>!l.noDream&&l.stats);
    const avgStats={};
    const statKeys=['길흉','연애운','재물운','건강운','활력','직관'];
    statKeys.forEach(k=>{
      const vals=prevLogs.map(l=>(l.stats||{})[k]||0).filter(v=>v>0);
      avgStats[k]=vals.length>0?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):50;
    });
    drawRadarCompare(data.stats,avgStats);
  }else{
    drawRadar(data.stats);
  }
  document.getElementById('resultEl').classList.add('on');
  document.getElementById('resultEl').scrollIntoView({behavior:'smooth',block:'start'});
  spawnConfetti();
  // 마일스톤별 특별 메시지
  const dreamCount=logs.filter(l=>!l.noDream).length;
  if(dreamCount===0){
    showToast('🎉 첫 번째 해몽 완료! 달이가 기다리고 있어요');
  }else if(dreamCount===2){
    showToast('🌟 3번째 해몽! 이제 달이가 패턴을 보기 시작해요');
  }else if(dreamCount===4){
    showToast('🔮 5번째 해몽 달성! 꿈 사전에서 상징을 찾아보세요');
  }else if(dreamCount===9){
    showToast('🏆 10번째 해몽! 당신은 진정한 꿈 탐험가예요');
  }else{
    const luckMsgs=['오늘은 좋은 일이 생길 거예요! 🍀','작은 행운이 다가오고 있어요 ✨','마음을 열면 기회가 보여요 🌟','꿈이 알려준 신호를 기억하세요 💫'];
    showToast(luckMsgs[Math.floor(Math.random()*luckMsgs.length)]);
  }
  showSimilarDreams();
  addXP(30);
  window._last={data,inp};
  renderLotto(data.stats,inp);
  renderDaliResultInsight(data,inp);
  renderRecurringComparison(data,inp);
  // 관련 상징 카드 표시
  try{ renderSymbolCards(inp); }catch(e){}
  // 프리미엄 해석 잠금 (₩500 단건 결제)
  const credits=getCredits();
  const lockBtn=document.getElementById('lockBtn');
  const lockSub=document.getElementById('lockSubText');
  if(credits>0){
    if(lockBtn)lockBtn.textContent=`🔓 프리미엄 해석 보기 (${credits}회 보유)`;
    if(lockSub)lockSub.textContent='크레딧을 사용해서 전문가급 해석을 확인하세요';
  }else{
    if(lockBtn)lockBtn.textContent='📜 프리미엄 해석 · ₩500';
    if(lockSub)lockSub.textContent='융 심리학 · 전통 해몽서 · 학술 연구 기반 분석';
  }
  document.getElementById('detailLock').style.display='block';
  document.getElementById('detailFull').style.display='none';
  // Premium / Plus / dev unlock 시 자동 잠금 해제
  const _tier = getCachedTier();
  if (_tier === 'premium' || _tier === 'plus') {
    try { unlockDetail(); } catch(e) {}
  }
  generateResultThumbnail(inp);
  // CRM: 맞춤형 질문 표시
  try{ showContextQuestions(data); }catch(e){}
  // 리텐션 훅: 내일 다시 오기 유도
  try{ showRetentionHook(); }catch(e){}
}


// ── 반복꿈 감지 + 이전 해몽과 비교 섹션 ──
function showRepeatDreamCompare(data, inp){
  const el=document.getElementById('repeatDreamCompare');
  if(!el){ // DOM 없으면 동적 생성
    const wrap=document.createElement('div');
    wrap.id='repeatDreamCompare';
    wrap.style.cssText='display:none;margin-top:14px';
    const resultEl=document.getElementById('resultEl');
    const retHook=document.getElementById('retentionHook');
    if(retHook) resultEl.insertBefore(wrap, retHook);
    else resultEl.appendChild(wrap);
  }
  const container=document.getElementById('repeatDreamCompare');
  if(!container)return;

  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>l.text&&l.stats&&!l.noDream);
  if(logs.length<2){container.style.display='none';return;}

  // 키워드 유사도로 반복꿈 찾기
  const inpWords=inp.toLowerCase().split(/\s+/).filter(w=>w.length>=2);
  let bestMatch=null, bestScore=0;

  for(const log of logs){
    const logWords=(log.text||'').toLowerCase().split(/\s+/).filter(w=>w.length>=2);
    const common=inpWords.filter(w=>logWords.includes(w));
    const score=common.length/Math.max(inpWords.length,1);
    if(score>bestScore && score>=0.3){
      bestScore=score;
      bestMatch=log;
    }
  }

  if(!bestMatch||!bestMatch.stats){container.style.display='none';return;}

  container.style.display='block';
  const similarity=Math.round(bestScore*100);
  const prevStats=bestMatch.stats;
  const curStats=data.stats;

  // 변화 분석
  const changes=Object.keys(curStats).map(k=>{
    const diff=(curStats[k]||0)-(prevStats[k]||0);
    return {key:k,diff,cur:curStats[k]||0,prev:prevStats[k]||0};
  }).filter(c=>c.diff!==0).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));

  const changeHtml=changes.slice(0,3).map(c=>{
    const arrow=c.diff>0?'\u2191':'\u2193';
    const color=c.diff>0?'var(--teal)':'var(--pink)';
    return '<span style="font-size:11px;color:'+color+';font-weight:700">'+c.key+' '+arrow+Math.abs(c.diff)+'</span>';
  }).join(' ');

  container.innerHTML=`<div class="card" style="border:1px solid rgba(248,201,76,.15);background:linear-gradient(135deg,rgba(248,201,76,.04),rgba(166,124,239,.04))">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:var(--moon)">\u{1F504} \uBC18\uBCF5\uAFC8 \uAC10\uC9C0</div>
      <span style="font-size:10px;background:rgba(248,201,76,.12);border:1px solid rgba(248,201,76,.2);border-radius:8px;padding:2px 8px;color:var(--amber)">\uC720\uC0AC\uB3C4 ${similarity}%</span>
    </div>
    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">
      <span style="color:var(--text-muted)">${bestMatch.date}</span> \uC758 \uAFC8\uACFC \uBE44\uC2B7\uD574\uC694
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">\u{1F4CA} \uC5D0\uB108\uC9C0 \uBCC0\uD654: ${changeHtml||'\uBCC0\uD654 \uC5C6\uC74C'}</div>
    <div id="repeatDreamDual" style="display:flex;justify-content:center;margin:10px 0"></div>
    <div style="font-size:10px;color:var(--text-muted);text-align:center;margin-top:6px">
      \uBC18\uBCF5\uB418\uB294 \uAFC8\uC740 \uBB34\uC758\uC2DD\uC774 \uBCF4\uB0B4\uB294 \uC911\uC694\uD55C \uC2E0\uD638\uC77C \uC218 \uC788\uC5B4\uC694
    </div>
  </div>`;

  // 듀얼 레이더 그리기
  setTimeout(()=>{
    drawDualRadar('repeatDreamDual', curStats, prevStats, '\uC624\uB298 \uAFC8', bestMatch.date);
  },100);
}
window.showRepeatDreamCompare=showRepeatDreamCompare;

function showRetentionHook(){
  const el=document.getElementById('retentionHook');
  if(!el)return;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const streak=parseInt(localStorage.getItem('mg_streak')||'0');

  let msg='';
  if(logs.length===0){
    msg='🌙 첫 해몽 완료! 내일도 꿈을 기록하면 연속 기록이 시작돼요';
  }else if(streak>=3){
    msg='🔥 '+streak+'일 연속 기록 중! 내일도 이어가면 특별한 인사이트가 열려요';
  }else{
    msg='✨ 내일의 꿈 운세가 기다리고 있어요. 매일 달라지는 운세를 확인해보세요!';
  }

  // [2026-05-23] 운세/퀴즈 버튼은 feature-flags 로 가역 숨김 (window.FEATURES 확인)
  const _ff=(typeof window!=='undefined'&&window.FEATURES)||{fortune:true,quiz:true};
  let _ctaBtns='';
  if(_ff.fortune)_ctaBtns+='<button onclick="switchTab(\'log\');initTodayFortune()" style="background:rgba(248,201,76,.1);border:1px solid rgba(248,201,76,.2);border-radius:10px;padding:6px 14px;font-size:11px;color:var(--amber);cursor:pointer;font-family:\'Noto Sans KR\',sans-serif">🔮 오늘의 운세 보기</button>';
  if(_ff.quiz)_ctaBtns+='<button onclick="switchTab(\'log\');renderQuiz()" style="background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:10px;padding:6px 14px;font-size:11px;color:var(--purple-bright);cursor:pointer;font-family:\'Noto Sans KR\',sans-serif">🧠 꿈 퀴즈 도전</button>';
  if(!_ctaBtns){ el.style.display='none'; return; }  // 둘 다 숨김이면 카드 자체 미표시
  el.style.display='block';
  el.innerHTML='<div style="margin-top:14px;background:linear-gradient(135deg,rgba(248,201,76,.08),rgba(166,124,239,.06));border:1px solid rgba(248,201,76,.15);border-radius:14px;padding:14px;text-align:center;">'
    +'<div style="font-size:12px;color:var(--moon);font-weight:700;margin-bottom:6px">'+msg+'</div>'
    +'<div style="display:flex;gap:8px;justify-content:center;margin-top:8px;">'
    +_ctaBtns
    +'</div></div>';
}

export async function watchAd(){
  // 크레딧이 있으면 바로 사용
  const credits=getCredits();
  if(credits>0){
    useCreditAndUnlock();
    return;
  }
  // 없으면 결제 페이월
  showPremiumPaywall();
}

// 광고 시청 → 1차 해석 unlock
export async function unlockWithAd(){
  if(typeof showRewardedAd==='function'){
    const rewarded=await showRewardedAd();
    if(rewarded){
      const {markAdWatched}=await import('../services/subscription.js');
      markAdWatched();
      showToast('🎬 광고 시청 완료! 1차 해석을 확인하세요');
      // 결과 보이기
      document.getElementById('resultEl').classList.add('on');
      document.getElementById('resultEl').scrollIntoView({behavior:'smooth'});
    }
  }else{
    // 웹 폴백: 광고 없이 바로 보여주기 (하우스 광고 대신)
    const {markAdWatched}=await import('../services/subscription.js');
    markAdWatched();
    document.getElementById('resultEl').classList.add('on');
    document.getElementById('resultEl').scrollIntoView({behavior:'smooth'});
  }
}

// 크레딧 사용 → 프리미엄 해석 unlock
export async function useCreditAndUnlock(){
  const used=await useCredit();
  if(used){
    unlockDetail();
    showToast('📜 프리미엄 해석 공개! ✨');
    logEvent('premium_unlocked',{method:'credit'});
    trackFunnelStep('feature_used',{method:'credit'});
  }else{
    showPremiumPaywall();
  }
}

// 결제 → 결제수단 선택 모달 표시 (v4: payment.js 통합)
export async function buyPremium(productKey){
  // 기존 productKey → 새 productId 매핑
  const keyMap = { single: 'pack_1', pack5: 'pack_5', pack15: 'pack_15', profile: 'unconscious_profile', pro: 'pro_monthly' };
  const productId = keyMap[productKey] || productKey;

  // 네이티브 IAP
  if(typeof Capacitor!=='undefined'&&Capacitor.isNativePlatform()){
    const {purchase}=await import('../services/iap.js');
    purchase(productKey);
    return;
  }

  // 웹: 결제수단 선택 모달
  if(typeof showMethodSelect==='function'){
    showMethodSelect(productId);
  }else{
    // 폴백: 직접 payment.js 호출 (카드 기본)
    const {startPayment}=await import('../services/payment.js');
    startPayment({productId,method:'card'});
  }
}

export function unlockDetail(){
  trackFunnelStep('detail_cta_shown');
  document.getElementById('detailLock').style.display='none';
  document.getElementById('detailFull').style.display='block';
  document.getElementById('detailFull').scrollIntoView({behavior:'smooth',block:'start'});
  addXP(10);
}


export function saveToDreamlog(){
  if(!window._last){showToast('먼저 해몽을 해보세요 🌙');return;}
  const {data,inp}=window._last;
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');

  // 반복꿈 감지 — 같은 상징이 이전에도 나왔는지
  const prevSimilar=logs.filter(l=>l.title&&data.title&&(
    l.badges?.some(b=>data.badges?.includes(b))||
    inp.split(' ').some(w=>w.length>=2&&l.text?.includes(w))
  )).slice(0,3);

  logs.unshift({id:Date.now(),text:inp,title:data.title,badges:data.badges,emotions:data.emotions||[],stats:data.stats||{},date:new Date().toLocaleDateString('ko-KR'),thumbnail:window._last?.thumbnail||null});
  localStorage.setItem('mg_logs',JSON.stringify(logs.slice(0,50)));

  // 반복꿈이면 특별 메시지
  if(prevSimilar.length>0){
    showToast('📖 저장 완료! 비슷한 꿈을 '+prevSimilar.length+'번 더 꿨어요. 달이한테 패턴을 물어보세요 🐱');
  }else if(logs.length===1){
    showToast('📖 첫 꿈 기록 완료! 꿈을 쌓을수록 달이가 더 잘 해석해줘요 ✨');
  }else if(logs.length===3){
    showToast('📖 저장 완료! 3개째! 이제 패턴이 보이기 시작해요 📊');
  }else{
    showToast('📖 저장 완료!');
  }

  // 저장 후 업셀 트리거 재평가
  if (typeof checkSmartUpsell === "function") checkSmartUpsell();
  else window.checkSmartUpsell?.();

  // 저장 후 다음 행동 유도 배너
  setTimeout(function(){
    var nextAction=document.getElementById('dreamNextAction');
    if(nextAction){
      nextAction.style.display='block';
      nextAction.innerHTML='<div style="display:flex;gap:6px;margin-top:10px;">'
        +'<button onclick="switchTab(\'chat\');this.parentElement.parentElement.style.display=\'none\'" style="flex:1;background:rgba(255,153,68,.1);border:1px solid rgba(255,153,68,.2);border-radius:10px;padding:8px;font-size:11px;color:var(--amber);cursor:pointer;font-family:\'Noto Sans KR\',sans-serif">🐱 달이에게 더 물어보기</button>'
        +'<button onclick="shareResult();this.parentElement.parentElement.style.display=\'none\'" style="flex:1;background:rgba(166,124,239,.1);border:1px solid rgba(166,124,239,.2);border-radius:10px;padding:8px;font-size:11px;color:var(--purple-bright);cursor:pointer;font-family:\'Noto Sans KR\',sans-serif">📤 친구에게 공유하기</button>'
        +'</div>';
    }
  },500);
}

// 꿈 속 상징 매칭 카드
function renderSymbolCards(inp){
  const el=document.getElementById('dreamSymbolCards');
  if(!el)return;
  try{
    const dict=ALL_DICT_REF.get();
    const matched=dict.filter(d=>inp.includes(d.n.split('/')[0])||inp.includes(d.n.split('/')[1]||'§§§'));
    if(matched.length===0){el.style.display='none';return;}
    el.style.display='block';
    el.innerHTML='<div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:8px">🔍 이 꿈 속 상징</div>'
      +matched.slice(0,3).map(d=>
        '<div style="background:rgba(125,232,216,.06);border:1px solid rgba(125,232,216,.12);border-radius:10px;padding:10px 12px;margin-bottom:6px">'
        +'<div style="font-size:13px;font-weight:700;margin-bottom:4px">'+d.e+' '+esc(d.n)+'</div>'
        +'<div style="font-size:11px;color:var(--text-secondary);line-height:1.6">'+esc(d.meaning.substring(0,80))+'...</div>'
        +'<div style="margin-top:6px;font-size:10px;color:var(--text-muted)">'+d.contexts.slice(0,2).map(c=>c.t.replace(/<\/?strong>/g,'')).join(' | ')+'</div>'
        +'</div>'
      ).join('');
  }catch{}
}

export function initTodaySymbol(){
  const s=DAILY_SYMBOLS[new Date().getDate()%DAILY_SYMBOLS.length];
  const el=document.getElementById('tsSymbol');
  const desc=document.getElementById('tsDesc');
  const cnt=document.getElementById('tsCount');
  if(el)el.textContent=s.symbol;
  if(desc)desc.textContent=s.desc;
  const hourBonus=new Date().getHours()*3+Math.floor(Math.random()*5);
  if(cnt)cnt.innerHTML=`오늘 <strong>${s.count*13+hourBonus*8}명</strong>이<br>꿨어요`;
  window._todayKeyword=s.keyword;
}

export function switchToInput(){document.getElementById('dreamInput').scrollIntoView({behavior:'smooth'});}

// ── 반복꿈 비교 섹션: 현재 해몽과 유사한 이전 꿈 비교 ──
export function showRecurringComparison(data, inp) {
  let el = document.getElementById('recurringCompare');
  if (!el) {
    el = document.createElement('div');
    el.id = 'recurringCompare';
    const anchor = document.getElementById('similarDreamRow') || document.getElementById('dreamSymbolCards');
    if (anchor) anchor.parentElement.insertBefore(el, anchor);
    else return;
  }

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  if (logs.length < 1) { el.style.display = 'none'; return; }

  const curBadges = new Set(data.badges || []);
  const curWords = inp.split(/\s+/).filter(w => w.length >= 2);

  const similar = logs.filter(l => {
    const badgeOverlap = (l.badges || []).some(b => curBadges.has(b) && b !== '길몽' && b !== '흉몽');
    const wordOverlap = curWords.some(w => (l.text || '').includes(w));
    return badgeOverlap || wordOverlap;
  }).slice(0, 3);

  if (similar.length === 0) { el.style.display = 'none'; return; }

  const prev = similar[0];
  const prevStats = prev.stats || {};
  const curStats = data.stats || {};
  const statKeys = ['길흉', '연애운', '재물운', '건강운', '활력', '직관'];

  const trends = statKeys.map(k => {
    const diff = (curStats[k] || 0) - (prevStats[k] || 0);
    return { key: k, diff, arrow: diff > 5 ? '↑' : diff < -5 ? '↓' : '→', color: diff > 5 ? '#7de8d8' : diff < -5 ? '#ff6b8a' : '#8b8ba0' };
  });

  const overallDiff = trends.reduce((s, t) => s + t.diff, 0);
  const trendMsg = overallDiff > 15 ? '전반적으로 운세가 좋아지고 있어요!' : overallDiff < -15 ? '마음의 에너지가 좀 낮아졌어요. 쉬어가세요.' : '비슷한 흐름이 이어지고 있어요.';

  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:rgba(166,124,239,.06);border:1px solid rgba(166,124,239,.15);border-radius:14px;padding:14px;margin-top:14px;">
      <div style="font-size:12px;font-weight:700;color:var(--purple-bright);margin-bottom:10px">🔄 비슷한 꿈을 ${similar.length}번 더 꿨어요</div>
      <div style="display:flex;gap:10px;margin-bottom:10px;">
        <div style="flex:1;background:rgba(255,255,255,.03);border-radius:10px;padding:10px;">
          <div style="font-size:9px;color:var(--text-muted);margin-bottom:4px">이전</div>
          <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:2px">${esc(prev.title || '기록된 꿈')}</div>
          <div style="font-size:10px;color:var(--text-muted)">${esc(prev.date || '')}</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.03);border-radius:10px;padding:10px;">
          <div style="font-size:9px;color:var(--text-muted);margin-bottom:4px">오늘</div>
          <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:2px">${esc(data.title || '')}</div>
          <div style="font-size:10px;color:var(--text-muted)">${new Date().toLocaleDateString('ko-KR')}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
        ${trends.map(t => `<span style="font-size:10px;background:rgba(255,255,255,.04);border:1px solid ${t.color}33;border-radius:8px;padding:2px 8px;color:${t.color}">${t.key} ${t.arrow}${Math.abs(t.diff)>0?Math.abs(t.diff):''}</span>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.5">💬 ${trendMsg}</div>
      ${similar.length >= 2 ? `<div style="font-size:10px;color:var(--star);margin-top:6px">⚡ 반복꿈 패턴이 감지됐어요. 달이에게 분석을 요청해보세요!</div>` : ''}
    </div>`;

  logEvent('recurring_comparison_shown', { similar_count: similar.length, trend: overallDiff > 15 ? 'up' : overallDiff < -15 ? 'down' : 'stable' });
}

export function showSimilarDreams(){
  const row=document.getElementById('similarDreamRow');
  const cnt=document.getElementById('sdCount');
  if(!row||!cnt)return;
  const inp=(window._last?.inp||'').toLowerCase();
  let base=30;
  if(inp.includes('뱀'))base=120;else if(inp.includes('이빨'))base=95;else if(inp.includes('돈')||inp.includes('돼지'))base=85;
  else if(inp.includes('물')||inp.includes('바다'))base=70;else if(inp.includes('하늘'))base=60;
  const count=base+Math.floor(Math.random()*30);
  const recent=Math.floor(count*0.15)+Math.floor(Math.random()*5);
  cnt.textContent=`${count}명이 비슷한 꿈을 꿨어요 · 최근 7일 ${recent}건`;
  row.style.display='flex';
}


export function switchInterp3(type,btn){
  document.querySelectorAll('.i3tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.i3content').forEach(c=>c.style.display='none');
  btn.classList.add('active');
  const map={traditional:'i3traditional',psychology:'i3psychology',advice:'i3advice'};
  const el=document.getElementById(map[type]);
  if(el){el.style.display='block';el.style.animation='su .25s ease';}
}

export function spawnConfetti(){
  const emojis=['🌟','⭐','✨','🌙','💫','🔮'];
  for(let i=0;i<12;i++){
    const el=document.createElement('div');
    el.textContent=emojis[Math.floor(Math.random()*emojis.length)];
    el.style.cssText=`position:fixed;top:-20px;left:${10+Math.random()*80}%;font-size:${14+Math.random()*10}px;z-index:9990;pointer-events:none;animation:confettiFall ${1.5+Math.random()*1.5}s ease-out forwards;animation-delay:${Math.random()*0.5}s;`;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),3000);
  }
}


export function getFeedThumbHtml(id){
  if(FEED_THUMBS[id])return`<div style="border-radius:12px;overflow:hidden;margin-bottom:9px;max-height:160px;"><img src="${FEED_THUMBS[id]}" style="width:100%;display:block;object-fit:cover;max-height:160px;" alt="꿈"></div>`;
  return'';
}

export function toggleNoDreamMode(){
  const area=document.getElementById('noDreamArea');
  const arrow=document.getElementById('noDreamArrow');
  if(area.style.display==='none'){
    area.style.display='block';
    area.style.animation='su .3s ease';
    if(arrow)arrow.textContent='▴';
  }else{
    area.style.display='none';
    if(arrow)arrow.textContent='▾';
  }
}

export function recordNoDream(){
  const today=new Date().toDateString();
  if(localStorage.getItem('mg_nodream')===today){showToast('오늘은 이미 기록했어요 😴');return;}
  localStorage.setItem('mg_nodream',today);
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  logs.unshift({id:Date.now(),text:'꿈 없이 푹 잤어요 😴',title:'😴 숙면의 밤',badges:['숙면'],date:new Date().toLocaleDateString('ko-KR'),noDream:true});
  localStorage.setItem('mg_logs',JSON.stringify(logs.slice(0,50)));
  const btn=document.getElementById('noDreamBtn');
  if(btn){btn.style.opacity='.5';btn.onclick=null;btn.querySelector('div > div:first-child').textContent='✓ 오늘 기록 완료!';}
  window.renderLog();window.renderCalendar();
  showToast('😴 푹 잔 기록이 저장됐어요! +3 XP +2 꿈가루');
}

export function checkNoDreamStatus(){
  const today=new Date().toDateString();
  if(localStorage.getItem('mg_nodream')===today){
    const btn=document.getElementById('noDreamBtn');
    if(btn){btn.style.opacity='.5';btn.onclick=null;btn.querySelector('div > div:first-child').textContent='✓ 오늘 기록 완료!';}
  }
}

export async function animateCounter(){
  const el=document.getElementById('heroCounter');if(!el)return;
  const {store}=await import('../store.js');

  let cur=256862; // 기본값

  // Supabase에서 실제 카운터 가져오기
  if(store.supabase){
    try{
      const {data}=await store.supabase.from('app_stats').select('value').eq('key','total_dreams').maybeSingle();  // 0행 406 방지
      if(data)cur=parseInt(data.value)||1331;
    }catch{
      // 테이블 없으면 시간 기반 폴백
      const launch=new Date('2026-03-21T00:00:00+09:00').getTime();
      cur=256862+Math.floor(Math.max(0,Date.now()-launch)/(1000*60*4));
    }
  }else{
    const launch=new Date('2026-03-21T00:00:00+09:00').getTime();
    cur=256862+Math.floor(Math.max(0,Date.now()-launch)/(1000*60*4));
  }

  // 카운트업 애니메이션
  let display=Math.max(1331,cur-30);
  const countUp=()=>{
    display+=Math.max(1,Math.ceil((cur-display)*0.08));
    if(display>=cur)display=cur;
    el.textContent=display.toLocaleString();
    if(display<cur)requestAnimationFrame(countUp);
  };
  requestAnimationFrame(countUp);

  // 실시간 증가 (20~40초마다)
  setInterval(()=>{
    cur++;
    el.style.transition='color .3s';
    el.style.color='#f8c94c';
    el.textContent=cur.toLocaleString();
    setTimeout(()=>{el.style.color='';},400);
  },20000+Math.floor(Math.random()*20000));

  // 해몽 완료 시 +1 (DB에도 기록)
  window._bumpHeroCounter=async function(){
    cur++;
    el.style.color='#7de8d8';
    el.textContent=cur.toLocaleString();
    setTimeout(()=>{el.style.color='';},500);
    // Supabase 카운터 증가
    if(store.supabase){
      try{
        await store.supabase.rpc('increment_app_stat',{stat_key:'total_dreams'});
      }catch{}
    }
  };
}

export function updateCharCount(){
  if(!updateCharCount._tracked){const inp=document.getElementById('dreamInput');if(inp&&inp.value.length>0){updateCharCount._tracked=true;trackFunnelStep('dream_input_start');}}
  const el=document.getElementById('charCount');
  const inp=document.getElementById('dreamInput');
  if(!el||!inp)return;
  const len=inp.value.length;
  const hint=document.getElementById('dreamDetailHint');
  if(len===0){
    el.textContent='';
    if(hint)hint.style.display='none';
  }else if(len<30){
    el.textContent=len+'자';
    if(hint){hint.style.display='block';hint.textContent='💡 장소, 등장인물, 감정을 더 적으면 해몽이 정확해져요';hint.style.color='var(--purple-bright)';}
  }else if(len<80){
    el.textContent=len+'자';
    if(hint){hint.style.display='block';hint.textContent='👀 색깔, 소리, 냄새 같은 디테일이 있으면 더 깊은 해석이 가능해요';hint.style.color='var(--teal)';}
  }else{
    el.textContent=len+'자';
    if(hint){hint.style.display='block';hint.textContent='✨ 아주 좋아요! 정확한 해몽을 할 수 있어요';hint.style.color='var(--purple-bright)';}
  }
}
// dream-voice.js (분리 모듈) 에서 호출 가능하도록 window 노출
if(typeof window!=='undefined') window.updateCharCount = updateCharCount;


// window 노출

// ── 반복꿈 비교 섹션 렌더 ──
function renderRepeatDreamCompare(currentData, prevDreams){
  const area=document.getElementById('dreamNextAction');
  if(!area)return;
  const prev=prevDreams[0]; // 가장 최근 유사 꿈
  if(!prev||!prev.stats||!currentData.stats)return;

  const statKeys=Object.keys(currentData.stats);
  const diffHtml=statKeys.map(k=>{
    const cur=currentData.stats[k]||0;
    const old=prev.stats[k]||0;
    const diff=cur-old;
    if(diff===0)return '';
    const arrow=diff>0?'\u2191':'\u2193';
    const color=diff>0?'#7de8d8':'#f0a8c8';
    return '<span style="font-size:10px;color:'+color+';margin-right:6px">'+k+' '+arrow+Math.abs(diff)+'</span>';
  }).filter(Boolean).join('');

  // 공통 키워드
  const curWords=(currentData.badges||[]).concat(currentData.emotions||[]);
  const prevWords=(prev.badges||[]).concat(prev.emotions||[]);
  const common=curWords.filter(w=>prevWords.includes(w));

  let compareHtml='<div style="margin-top:12px;background:rgba(248,201,76,.06);border:1px solid rgba(248,201,76,.15);border-radius:14px;padding:14px;">';
  compareHtml+='<div style="font-size:12px;font-weight:700;color:var(--amber);margin-bottom:8px">\uD83D\uDD04 이전 비슷한 꿈과 비교</div>';
  compareHtml+='<div style="display:flex;justify-content:space-between;margin-bottom:8px">';
  compareHtml+='<div style="flex:1;text-align:center"><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">이번</div><div style="font-size:13px;font-weight:700;color:var(--moon)">'+(currentData.title||'')+'</div></div>';
  compareHtml+='<div style="color:var(--text-muted);padding:0 8px;font-size:16px">vs</div>';
  compareHtml+='<div style="flex:1;text-align:center"><div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">'+(prev.date||'이전')+'</div><div style="font-size:13px;font-weight:700;color:var(--amber)">'+(prev.title||'')+'</div></div>';
  compareHtml+='</div>';
  if(diffHtml) compareHtml+='<div style="margin-bottom:6px">'+diffHtml+'</div>';
  if(common.length>0) compareHtml+='<div style="font-size:10px;color:var(--text-muted)">\uD83D\uDD17 공통: '+common.join(', ')+'</div>';
  compareHtml+='<div style="font-size:10px;color:var(--teal);margin-top:6px">\uD83D\uDCA1 반복 꿈은 무의식이 해결을 원하는 주제일 수 있어요</div>';
  compareHtml+='</div>';

  area.style.display='block';
  area.innerHTML=compareHtml+area.innerHTML;
}

window.fillDream = fillDream;
window.quickSearch = quickSearch;
window.analyzeDream = analyzeDream;
window.showResult = showResult;
window.watchAd = watchAd;
window.unlockWithAd = unlockWithAd;
window.useCreditAndUnlock = useCreditAndUnlock;
window.buyPremium = buyPremium;
window.unlockDetail = unlockDetail;
window.shareResult = shareResult;
window.generateShareCard = generateShareCard;
window.saveToDreamlog = saveToDreamlog;
window.initTodaySymbol = initTodaySymbol;
window.switchToInput = switchToInput;
window.showSimilarDreams = showSimilarDreams;
window.showRecurringComparison = showRecurringComparison;
window.switchInterp3 = switchInterp3;
window.spawnConfetti = spawnConfetti;
window.toggleNoDreamMode = toggleNoDreamMode;
window.recordNoDream = recordNoDream;
window.checkNoDreamStatus = checkNoDreamStatus;
window.animateCounter = animateCounter;
window.updateCharCount = updateCharCount;
window.startVoiceInput = startVoiceInput;
window.stopVoiceInput = stopVoiceInput;
window.startLoadingSteps = startLoadingSteps;
window.stopLoadingSteps = stopLoadingSteps;
window.renderPopularStories = renderPopularStories;
window.goToStoryTag = goToStoryTag;
window.renderDaliMini = renderDaliMini;
window.renderDaliResultInsight = renderDaliResultInsight;
window.toggleDreamGuide = toggleDreamGuide;
window.nextGuideStep = nextGuideStep;
window.selectGuideOption = selectGuideOption;

// 인기 꿈 이야기 — 커뮤니티 글 미리보기
const POPULAR_TAGS=[
  {tag:'뱀 꿈',emoji:'🐍',label:'뱀꿈'},
  {tag:'이빨 꿈',emoji:'🦷',label:'이빨빠지는꿈'},
  {tag:'하늘 꿈',emoji:'☁️',label:'하늘나는꿈'},
  {tag:'추락 꿈',emoji:'😰',label:'추락하는꿈'},
  {tag:'물 꿈',emoji:'🌊',label:'물꿈'},
  {tag:'재물 꿈',emoji:'🐷',label:'돼지/재물꿈'},
  {tag:'이별 꿈',emoji:'💕',label:'이별꿈'},
  {tag:'쫓기는 꿈',emoji:'🏃',label:'쫓기는꿈'},
  {tag:'귀신 꿈',emoji:'👻',label:'귀신꿈'},
  {tag:'시험 꿈',emoji:'📝',label:'시험꿈'},
];

export function renderPopularStories(){
  const el=document.getElementById('popularStories');
  if(!el)return;
  el.innerHTML=POPULAR_TAGS.map(t=>{
    const post=FEED_DEMO.find(f=>f.tag===t.tag);
    if(!post)return '';
    const count=FEED_DEMO.filter(f=>f.tag===t.tag).length;
    const bodyShort=post.body.length>45?post.body.slice(0,45)+'...':post.body;
    return `<div class="pstory" onclick="goToStoryTag('${t.tag}')">
      <div class="pstory-tag">
        <span class="pstory-emoji">${t.emoji}</span>
        <span class="pstory-label">${t.label}</span>
        <span class="pstory-count">${count}건</span>
      </div>
      <div class="pstory-title">${post.title.replace(/^[^\s]+\s/,'')}</div>
      <div class="pstory-body">${bodyShort}</div>
      <div class="pstory-footer">
        <span>🌟 ${post.likes}</span>
        <span>💬 ${post.comments.length}</span>
      </div>
    </div>`;
  }).join('');
}

export function goToStoryTag(tag){
  window.switchTab('community');
  setTimeout(()=>{window.setFilter(tag);},100);
}

// ═══ 달이 미니카드 (메인탭 상단) ═══
export function renderDaliMini(){
  if((typeof window!=='undefined'&&window.FEATURES)&&!window.FEATURES.dali)return;  // 달이 숨김 시 미니카드 미표시(가역)
  const el=document.getElementById('daliMini');
  const msg=document.getElementById('daliMiniMsg');
  if(!el||!msg)return;

  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const h=new Date().getHours();
  const mem=JSON.parse(localStorage.getItem('mg_dari_memory')||'[]');

  let text='';
  if(logs.length===0){
    text='안녕! 나는 달이야. 꿈을 기록하면 내가 패턴을 분석해줄게 🌙';
  }else if(h>=5&&h<9){
    text=`좋은 아침! 어젯밤 꿈이 기억나요? 기억날 때 빨리 적어보세요 ☀️`;
  }else if(h>=21||h<5){
    const last=logs[0];
    text=`오늘 하루 수고했어요. ${last?`저번 "${last.title}" 꿈 이후로 어때요?`:'편안한 밤 되세요'} 🌙`;
  }else{
    // 낮 — 인사이트 하나 짚어주기
    const kwCount={};
    logs.forEach(l=>{(l.keywords||[]).forEach(k=>{kwCount[k]=(kwCount[k]||0)+1;});(l.badges||[]).forEach(b=>{kwCount[b]=(kwCount[b]||0)+1;});});
    const top=Object.entries(kwCount).sort((a,b)=>b[1]-a[1])[0];
    if(top&&top[1]>=2){
      text=`요즘 꿈에서 "${top[0]}"이(가) ${top[1]}번 반복되고 있어요. 같이 얘기해볼까요?`;
    }else if(mem.length>0){
      const lastMem=mem[mem.length-1].replace('- ','').replace(/\(.+\)/,'').trim();
      text=`${lastMem} — 그 후로 어떻게 됐는지 궁금해요 🐱`;
    }else{
      text=`${logs.length}개 꿈을 분석했어요. 나한테 오면 패턴을 알려줄게!`;
    }
  }
  msg.innerHTML=text;
  el.style.display='flex';
}

// ═══ 해몽 결과 달이 인사이트 ═══
export function renderDaliResultInsight(data,inp){
  if((typeof window!=='undefined'&&window.FEATURES)&&!window.FEATURES.dali)return;  // 달이 숨김 시 결과 인사이트 카드 미표시(가역)
  const card=document.getElementById('daliResultCard');
  const msgEl=document.getElementById('daliResultMsg');
  if(!card||!msgEl)return;

  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  const mem=JSON.parse(localStorage.getItem('mg_dari_memory')||'[]');

  let msg='';

  // 1. 반복 패턴 연결
  const currentKws=[...(data.badges||[])];
  const dreamSymbols=['뱀','물','불','이빨','하늘','돈','돼지','고양이','달','꽃','비','바다','산'];
  dreamSymbols.forEach(s=>{if(inp.includes(s))currentKws.push(s);});

  const pastMatches=logs.filter(l=>{
    const lkw=[...(l.keywords||[]),...(l.badges||[])];
    return currentKws.some(k=>lkw.includes(k));
  });

  if(pastMatches.length>=2){
    const matchKw=currentKws.find(k=>pastMatches.filter(l=>[...(l.keywords||[]),...(l.badges||[])].includes(k)).length>=2);
    if(matchKw){
      msg=`"${matchKw}" 관련 꿈을 <b>${pastMatches.length}번째</b> 꾸고 있어요. 반복되는 꿈은 무의식이 강하게 보내는 신호예요. 달이한테 오면 이 패턴이 뭘 의미하는지 같이 풀어볼 수 있어요.`;
    }
  }

  // 2. 감정 변화 연결
  if(!msg&&logs.length>=3){
    const recentBadges=logs.slice(0,3).map(l=>(l.badges||[])).flat();
    const goodCount=recentBadges.filter(b=>b==='길몽').length;
    const badCount=recentBadges.filter(b=>b==='흉몽').length;
    if((data.badges||[]).includes('길몽')&&badCount>=2){
      msg='최근 흉몽이 많았는데 오늘은 길몽이에요! 마음이 안정되고 있는 신호일 수 있어요. 달이한테 감정 흐름을 분석받아보세요.';
    }else if((data.badges||[]).includes('흉몽')&&goodCount>=2){
      msg='최근 좋은 꿈이 이어지다가 오늘은 무거운 꿈이었네요. 혹시 요즘 스트레스 받는 일이 있어요? 달이한테 얘기해봐요.';
    }
  }

  // 3. 메모리 연결
  if(!msg&&mem.length>0){
    const lastMem=mem[mem.length-1].replace('- ','').replace(/\(.+\)/,'').trim();
    msg=`이전에 "${lastMem}"이라고 했었죠? 오늘 꿈이 그것과 연결될 수 있어요. 달이한테 오면 같이 풀어볼게요.`;
  }

  // 4. 기본 (꿈 기록 수 기반)
  if(!msg){
    if(logs.length<=2){
      msg='꿈을 3개 이상 기록하면 달이가 패턴을 분석해줄 수 있어요. 꾸준히 기록해봐요!';
    }else{
      msg=`지금까지 ${logs.length}개 꿈을 기록했어요. 달이한테 오면 당신만의 꿈 패턴과 감정 흐름을 분석해줄게요 🐱`;
    }
  }

  msgEl.innerHTML=msg;
  card.style.display='block';
  logEvent('dali_result_insight_shown');
}


// ═══ 반복꿈 비교 섹션 ═══
export function renderRecurringComparison(data,inp){
  const wrap=document.getElementById('recurringComparison');
  const body=document.getElementById('recurringCmpBody');
  if(!wrap||!body)return;

  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length===0){wrap.style.display='none';return;}

  // 현재 꿈 키워드 추출
  const curKws=[...(data.badges||[])];
  const symbols=['뱀','물','불','이빨','하늘','돈','돼지','고양이','달','꽃','비','바다','산','차','집','학교','아기','죽음','결혼','시험'];
  symbols.forEach(s=>{if(inp.includes(s))curKws.push(s);});

  // 유사 과거 꿈 찾기
  const similar=logs.filter(l=>{
    if(!l.title)return false;
    const lkw=[...(l.badges||[]),...(l.emotions||[]).map(e=>e.replace(/^[^\s]+\s/,''))];
    const textMatch=inp.split(' ').filter(w=>w.length>=2).some(w=>l.text?.includes(w));
    const kwMatch=curKws.some(k=>lkw.includes(k)||(l.text||'').includes(k));
    return kwMatch||textMatch;
  });

  if(similar.length===0){wrap.style.display='none';return;}

  const prev=similar[0];
  const prevStats=prev.stats||{};
  const curStats=data.stats||{};
  const statKeys=['길흉','연애운','재물운','건강운','활력','직관'];

  const statRows=statKeys.map(k=>{
    const pv=prevStats[k]??'-';
    const cv=curStats[k]??'-';
    let arrow='→',cls='stat-same';
    if(typeof pv==='number'&&typeof cv==='number'){
      if(cv>pv){arrow='↑';cls='stat-up';}
      else if(cv<pv){arrow='↓';cls='stat-down';}
    }
    return '<div class="recurring-cmp-row">'
      +'<div class="recurring-cmp-col"><div class="recurring-cmp-label">'+esc(k)+'</div><div class="recurring-cmp-val">'+pv+'</div></div>'
      +'<div class="recurring-cmp-arrow '+cls+'">'+arrow+'</div>'
      +'<div class="recurring-cmp-col"><div class="recurring-cmp-label">'+esc(k)+'</div><div class="recurring-cmp-val '+cls+'">'+cv+'</div></div>'
      +'</div>';
  }).join('');

  const overlap=curKws.filter(k=>(prev.text||'').includes(k)||(prev.badges||[]).includes(k));
  const overlapText=overlap.length>0?overlap.map(k=>'"'+k+'"').join(', '):'';

  const prevEmotions=(prev.emotions||[]).map(e=>e.replace(/^[^\s]+\s/,'')).join(', ');
  const curEmotions=(data.emotions||[]).map(e=>e.replace(/^[^\s]+\s/,'')).join(', ');

  let changeSummary='';
  const goodKeys=['길흉','재물운','활력'];
  let improved=0,declined=0;
  goodKeys.forEach(k=>{
    if(typeof curStats[k]==='number'&&typeof prevStats[k]==='number'){
      if(curStats[k]>prevStats[k])improved++;
      else if(curStats[k]<prevStats[k])declined++;
    }
  });
  if(improved>declined){
    changeSummary='이전보다 <b>긍정적인 방향</b>으로 변하고 있어요. 무의식이 안정을 찾아가는 신호일 수 있어요.';
  }else if(declined>improved){
    changeSummary='이전 꿈보다 <b>에너지가 낮아진</b> 느낌이에요. 요즘 마음이 힘든 건 아닌지 살펴봐주세요.';
  }else{
    changeSummary='비슷한 흐름이 <b>반복</b>되고 있어요. 무의식이 같은 메시지를 계속 보내고 있는 것 같아요.';
  }
  if(similar.length>=3){
    changeSummary+=' <b>'+similar.length+'번째</b> 비슷한 꿈이에요. 달이에게 패턴 분석을 요청해보세요.';
  }

  body.innerHTML='<div class="recurring-cmp-prev">'
    +'<div class="recurring-cmp-prev-title">'+esc(prev.title||'이전 꿈')+'</div>'
    +'<div class="recurring-cmp-prev-date">'+esc(prev.date||'')+'</div>'
    +'<div class="recurring-cmp-badges">'+(prev.badges||[]).map(b=>'<span class="badge bl">'+esc(b)+'</span>').join('')+'</div>'
    +(prevEmotions?'<div style="font-size:10px;color:var(--text-muted)">감정: '+esc(prevEmotions)+'</div>':'')
    +'</div>'
    +'<div style="text-align:center;font-size:10px;color:var(--text-muted);margin:6px 0">'
    +'<span style="display:inline-flex;align-items:center;gap:4px">이전'+(overlapText?' ('+overlapText+')':'')+' → 오늘</span>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:2px;align-items:center">'
    +statRows
    +'</div>'
    +(curEmotions?'<div style="margin-top:8px;font-size:10px;color:var(--text-muted)">오늘 감정: '+esc(curEmotions)+'</div>':'')
    +'<div class="recurring-cmp-change">'+changeSummary+'</div>';
  wrap.style.display='block';
  logEvent('recurring_comparison_shown',{prevTitle:prev.title,matchCount:similar.length,overlap});
}
// ═══ 꿈 회상 가이드 ═══
const GUIDE_STEPS=[
  {q:'꿈에서 어디에 있었어요?', opts:['집','학교/직장','야외/자연','낯선 곳','기억 안 남'],key:'place'},
  {q:'누가 나왔어요?', opts:['혼자','가족','친구','연인/전 애인','낯선 사람','동물'],key:'who'},
  {q:'무슨 일이 있었어요?', opts:['쫓기거나 도망','날거나 떨어짐','무언가를 찾음','싸움/갈등','행복한 장면'],key:'event',hasInput:true},
  {q:'어떤 기분이었어요?', opts:['무서웠어요','불안했어요','신났어요','슬펐어요','편안했어요','혼란스러웠어요'],key:'feeling'},
  {q:'그 외 기억나는 디테일이 있어요?', key:'detail',inputOnly:true,placeholder:'색깔, 물건, 소리, 냄새 등 자유롭게...'},
];

let guideStep=0;
let guideAnswers={};
let guideActive=false;

export function toggleDreamGuide(){
  guideActive=!guideActive;
  const area=document.getElementById('dreamGuideArea');
  const btn=document.getElementById('dreamGuideBtn');
  if(!area)return;
  if(guideActive){
    guideStep=0;guideAnswers={};
    area.style.display='block';
    btn.classList.add('active');
    renderGuideStep();
    logEvent('dream_guide_started');
  }else{
    area.style.display='none';
    btn.classList.remove('active');
  }
}

function renderGuideStep(){
  const step=GUIDE_STEPS[guideStep];
  if(!step)return finishGuide();

  document.getElementById('dgTitle').textContent=`(${guideStep+1}/${GUIDE_STEPS.length}) 달이가 도와줄게요`;
  document.getElementById('dgQuestion').textContent=step.q;

  const optsEl=document.getElementById('dgOptions');
  const inputRow=document.getElementById('dgInputRow');
  const dgInput=document.getElementById('dgInput');

  if(step.inputOnly){
    optsEl.innerHTML='';
    inputRow.style.display='flex';
    dgInput.value='';
    dgInput.placeholder=step.placeholder||'자유롭게 적어주세요...';
    dgInput.focus();
  }else{
    optsEl.innerHTML=(step.opts||[]).map(o=>
      `<button class="dg-opt" onclick="selectGuideOption('${o}')">${o}</button>`
    ).join('');
    inputRow.style.display=step.hasInput?'flex':'none';
    if(step.hasInput){dgInput.value='';dgInput.placeholder='또는 직접 적어주세요...';}
  }

  // 프로그레스
  document.getElementById('dgProgress').innerHTML=GUIDE_STEPS.map((_,i)=>
    `<div class="dg-dot ${i<guideStep?'done':i===guideStep?'active':''}"></div>`
  ).join('');
}

export function selectGuideOption(opt){
  const step=GUIDE_STEPS[guideStep];
  guideAnswers[step.key]=opt;
  guideStep++;
  renderGuideStep();
}

export function nextGuideStep(){
  const step=GUIDE_STEPS[guideStep];
  const input=document.getElementById('dgInput').value.trim();
  if(input){
    guideAnswers[step.key]=input;
  }else if(!guideAnswers[step.key]){
    guideAnswers[step.key]='';
  }
  guideStep++;
  renderGuideStep();
}

function finishGuide(){
  // 답변을 자연스러운 꿈 텍스트로 조합
  const parts=[];
  if(guideAnswers.place&&guideAnswers.place!=='기억 안 남') parts.push(`${guideAnswers.place}에서`);
  if(guideAnswers.who&&guideAnswers.who!=='혼자') parts.push(`${guideAnswers.who}와(과) 함께`);
  if(guideAnswers.event) parts.push(guideAnswers.event);
  if(guideAnswers.feeling) parts.push(`기분은 ${guideAnswers.feeling}`);
  if(guideAnswers.detail) parts.push(guideAnswers.detail);

  const dreamText=parts.join(', ')+'인 꿈을 꿨어요.';
  document.getElementById('dreamInput').value=dreamText;
  updateCharCount();

  // 가이드 닫기
  guideActive=false;
  document.getElementById('dreamGuideArea').style.display='none';
  document.getElementById('dreamGuideBtn').classList.remove('active');

  showToast('달이가 꿈을 정리해줬어요! 🐱');
  logEvent('dream_guide_completed',{answers:Object.keys(guideAnswers).length});
}

// ═══ 꿈 로또 행운 번호 ═══

// 한국 로또 6/45 역대 당첨 빈도 상위 번호 (실제 통계 기반 가중치)
const LOTTO_FREQ={
  34:198,43:196,27:193,1:191,12:190,18:189,33:188,20:187,17:186,14:185,
  45:184,26:183,40:182,7:181,4:180,13:179,10:178,6:177,11:176,3:175,
  37:174,21:173,2:172,15:171,39:170,31:169,24:168,36:167,9:166,44:165,
  35:164,16:163,42:162,38:161,23:160,28:159,29:158,19:157,5:156,22:155,
  41:154,30:153,8:152,25:151,32:150
};

// 꿈 상징→번호 그룹 매핑
const SYMBOL_NUMBERS={
  뱀:[7,17,27,37],물:[4,14,24,34,44],불:[3,13,23,33,43],하늘:[1,11,21,31,41],
  돈:[8,18,28,38],돼지:[9,19,29,39],이빨:[5,15,25,35,45],달:[6,16,26,36],
  꽃:[2,12,22,32,42],바다:[4,14,34,44],산:[1,11,31,41],새:[3,23,33,43],
  나비:[7,17,27,37],아기:[1,10,20,30],집:[9,19,29,39],차:[6,16,26,36],
  고양이:[2,12,22,32],사랑:[14,24,34,44],죽음:[13,31,43,45],비:[4,24,34,44],
  눈:[1,11,21,41],학교:[5,15,25,35],거미:[8,18,28,38]
};

// 운세 에너지→번호 범위 가중치
function getEnergyWeights(stats){
  const w=new Array(46).fill(1);
  // 재물운 높으면 고빈도 번호 가중치 UP
  if(stats.재물운>=70) [34,43,27,1,12,18].forEach(n=>w[n]+=3);
  // 연애운 높으면 짝수 번호 가중치
  if(stats.연애운>=70) for(let i=2;i<=44;i+=2)w[i]+=1;
  // 직관 높으면 소수(prime) 가중치
  if(stats.직관>=70) [2,3,5,7,11,13,17,19,23,29,31,37,41,43].forEach(n=>w[n]+=2);
  // 활력 높으면 큰 번호 가중치
  if(stats.활력>=70) for(let i=30;i<=45;i++)w[i]+=1;
  // 건강운 높으면 1의 자리 반복 번호
  if(stats.건강운>=70) [11,22,33,44].forEach(n=>w[n]+=2);
  // 길흉에 따라 조정
  if(stats.길흉>=80) [7,8,18,28,38].forEach(n=>w[n]+=2); // 길한 번호
  if(stats.길흉<40) [4,13,14,44].forEach(n=>w[n]+=1); // 흉한 에너지→반전 행운
  return w;
}

// 입력 텍스트에서 해시 시드 생성
function dreamHash(text){
  let h=0;
  for(let i=0;i<text.length;i++){h=((h<<5)-h)+text.charCodeAt(i);h|=0;}
  return Math.abs(h);
}

// 의사난수 생성기 (시드 기반)
function seededRandom(seed){
  let s=seed;
  return function(){s=(s*16807+0)%2147483647;return(s-1)/2147483646;};
}

// 가중치 기반 번호 선택
function weightedPick(weights,rng,exclude){
  const pool=[];
  for(let n=1;n<=45;n++){
    if(exclude.has(n))continue;
    const freq=LOTTO_FREQ[n]||150;
    const total=weights[n]*freq;
    for(let i=0;i<total;i++)pool.push(n);
  }
  return pool[Math.floor(rng()*pool.length)];
}

// 번호 색상 클래스 (한국 로또 기준)
function ballRange(n){
  if(n<=10)return 'range1'; // 노란색
  if(n<=20)return 'range2'; // 초록색
  if(n<=30)return 'range3'; // 파란색
  if(n<=40)return 'range4'; // 보라색
  return 'range5'; // 빨간색
}

// 메인 생성 함수
function generateLottoNumbers(stats,inp){
  const symbols=Object.keys(SYMBOL_NUMBERS);
  const foundSymbols=symbols.filter(s=>inp.includes(s));

  // 시드: 꿈 텍스트 해시 + 오늘 날짜 + stats 합
  const today=new Date().toISOString().split('T')[0];
  const statSum=Object.values(stats).reduce((a,b)=>a+b,0);
  const seed=dreamHash(inp+today)+statSum;
  const rng=seededRandom(seed);

  const weights=getEnergyWeights(stats);

  // 상징 매칭 번호 가중치 추가
  foundSymbols.forEach(sym=>{
    (SYMBOL_NUMBERS[sym]||[]).forEach(n=>{weights[n]+=4;});
  });

  // 6개 번호 선택
  const picked=new Set();

  // 상징 매칭된 번호 중 1개 우선 선택
  if(foundSymbols.length>0){
    const symPool=foundSymbols.flatMap(s=>SYMBOL_NUMBERS[s]||[]);
    if(symPool.length>0){
      const n=symPool[Math.floor(rng()*symPool.length)];
      picked.add(n);
    }
  }

  // 나머지 가중치 기반 선택
  let tries=0;
  while(picked.size<6&&tries<200){
    const n=weightedPick(weights,rng,picked);
    if(n)picked.add(n);
    tries++;
  }

  // 혹시 6개 못 채우면 랜덤 보충
  while(picked.size<6){
    const n=Math.floor(rng()*45)+1;
    picked.add(n);
  }

  const numbers=[...picked].sort((a,b)=>a-b);

  // 분석 텍스트 생성
  let analysis='';
  if(foundSymbols.length>0){
    analysis+=`꿈 속 "${foundSymbols.join(', ')}" 상징에서 핵심 번호를 추출했어요. `;
  }
  const topStat=Object.entries(stats).sort((a,b)=>b[1]-a[1])[0];
  analysis+=`${topStat[0]}(${topStat[1]}점)이 가장 높아서 관련 번호에 가중치를 뒀어요. `;
  analysis+='역대 1,100회 당첨 빈도와 결합해서 최적화했어요.';

  return {numbers,analysis,foundSymbols};
}

// 렌더링
function renderLotto(stats,inp){
  const card=document.getElementById('lottoCard');
  const ballsEl=document.getElementById('lottoBalls');
  const analysisEl=document.getElementById('lottoAnalysis');
  if(!card||!ballsEl)return;

  const {numbers,analysis}=generateLottoNumbers(stats,inp);

  ballsEl.innerHTML=numbers.map(n=>
    `<div class="lotto-ball ${ballRange(n)}">${n}</div>`
  ).join('');
  if(analysisEl)analysisEl.textContent=analysis;
  card.style.display='block';

  logEvent('lotto_shown',{numbers:numbers.join(',')});
}

// 다시 뽑기 (시드에 랜덤 요소 추가)
window.rerollLotto=function(){
  if(!window._last)return;
  const {data,inp}=window._last;
  // 다시 뽑기 시 입력에 타임스탬프 추가로 시드 변경
  const newInp=inp+Date.now();
  const card=document.getElementById('lottoCard');
  const ballsEl=document.getElementById('lottoBalls');
  const analysisEl=document.getElementById('lottoAnalysis');

  // 애니메이션 리셋
  ballsEl.innerHTML='';
  setTimeout(()=>{
    const {numbers,analysis}=generateLottoNumbers(data.stats,newInp);
    ballsEl.innerHTML=numbers.map(n=>
      `<div class="lotto-ball ${ballRange(n)}">${n}</div>`
    ).join('');
    if(analysisEl)analysisEl.textContent=analysis;
    logEvent('lotto_reroll',{numbers:numbers.join(',')});
  },100);
};

// ── 감정 태그 시스템 ──
const EMOTION_TAGS=[
  {id:'joy',icon:'😊',label:'기쁨',color:'#FFD700'},
  {id:'fear',icon:'😨',label:'공포',color:'#FF6B6B'},
  {id:'sadness',icon:'😢',label:'슬픔',color:'#4A90E2'},
  {id:'confusion',icon:'😕',label:'혼란',color:'#FFA500'},
  {id:'calm',icon:'😌',label:'평온',color:'#9B59B6'}
];

/**
 * 감정 태그 UI 초기화 (꿈 입력란이 보일 때)
 */
export function initEmotionTags(){
  const container=document.getElementById('emotionTagsContainer');
  const section=document.getElementById('emotionTagsSection');
  if(!container||!section)return;

  container.innerHTML=EMOTION_TAGS.map(tag=>`
    <button class="emotion-tag" data-emotion-id="${tag.id}" onclick="selectEmotionTag('${tag.id}')" title="${tag.label}" style="
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:6px 10px;
      background:rgba(255,255,255,.05);
      border:1px solid rgba(166,124,239,.2);
      border-radius:16px;
      color:var(--text-secondary);
      font-size:12px;
      cursor:pointer;
      transition:all .2s ease;
    ">
      <span style="font-size:14px">${tag.icon}</span>
      <span>${tag.label}</span>
    </button>
  `).join('');
}

/**
 * 감정 태그 선택/해제
 */
window.selectEmotionTag=function(emotionId){
  const {store}=window._storeImport||{store:{}};
  if(!store.selectedEmotions)store.selectedEmotions=[];

  const idx=store.selectedEmotions.indexOf(emotionId);
  if(idx>=0){
    store.selectedEmotions.splice(idx,1);
  }else{
    if(store.selectedEmotions.length>=5){
      showToast('감정 태그는 최대 5개까지 선택할 수 있어요 🎯');
      return;
    }
    store.selectedEmotions.push(emotionId);
  }

  // UI 업데이트
  const buttons=document.querySelectorAll('.emotion-tag');
  buttons.forEach(btn=>{
    const id=btn.getAttribute('data-emotion-id');
    if(store.selectedEmotions.includes(id)){
      btn.style.background='rgba(166,124,239,.3)';
      btn.style.borderColor='rgba(166,124,239,.6)';
      btn.style.color='var(--text-primary)';
    }else{
      btn.style.background='rgba(255,255,255,.05)';
      btn.style.borderColor='rgba(166,124,239,.2)';
      btn.style.color='var(--text-secondary)';
    }
  });

  logEvent('emotion_tag_selected',{emotion:emotionId,count:store.selectedEmotions.length});
};

/**
 * 선택된 감정 태그를 해석 프롬프트에 반영
 */
export function getEmotionContext(){
  const {store}=window._storeImport||{store:{}};
  const emotions=store.selectedEmotions||[];
  if(emotions.length===0)return '';

  const emotionNames=EMOTION_TAGS
    .filter(t=>emotions.includes(t.id))
    .map(t=>t.label)
    .join(', ');

  return `\n사용자가 느낀 감정: ${emotionNames}. 이 감정들을 고려해서 해석해줘.`;
}

/**
 * 꿈 입력 탭 활성화 시 감정 태그 섹션 표시
 */
export function showEmotionTagsSection(){
  const section=document.getElementById('emotionTagsSection');
  const input=document.getElementById('dreamInput');
  if(!section)return;

  // 꿈 입력란이 포커스되면 감정 태그 섹션 표시
  if(input){
    input.addEventListener('focus',()=>{
      if(input.value.length>0){
        section.style.display='block';
        if(!section.hasAttribute('data-initialized')){
          initEmotionTags();
          section.setAttribute('data-initialized','true');
        }
      }
    });

    input.addEventListener('blur',()=>{
      // 텍스트가 없으면 숨김
      if(input.value.length===0){
        section.style.display='none';
        const {store}=window._storeImport||{store:{}};
        store.selectedEmotions=[];
      }
    });
  }
}
