// 몽글몽글 — 달이 채팅 로직 (dali.js에서 분리)
import { store } from '../store.js';
import { callOpenAI, callChat } from '../services/api.js';
import { showToast } from '../components/toast.js';
import { esc } from '../utils/sanitize.js';
import { logEvent } from '../services/analytics.js';
import { addXPSilent } from './my.js';
import { canSuggestPremium, markPremiumSuggested } from '../services/subscription.js';
import { detectSuggestionContext, pickSuggestionMessage } from '../utils/dali-premium-prompts.js';
import { detectCrisis, CRISIS_HTML } from '../utils/crisis.js';
import { analyzeDreamData, getDreamLogs, getDariMemory, getJoinDays, getTimeContext } from './dali.js';

// ── 채팅 ──
export async function sendChat(){
  const inp=document.getElementById('chatIn');
  const msg=inp.value.trim();if(!msg)return;
  logEvent('dali_message_sent',{length:msg.length});
  inp.value='';addBubble(msg,'me');
  store.chatHist.push({role:'user',content:msg});
  localStorage.setItem('mg_chat_hist',JSON.stringify(store.chatHist.slice(-20)));

  // [정신건강 안전망] 1인칭 자기위해/자살 사고 감지 시 전문 상담 안내 우선 노출.
  //   꿈 서술은 detectCrisis 내부에서 제외 → 정상 해몽 가로채기 0.
  if(detectCrisis(msg)){
    logEvent('crisis_guidance_shown',{len:msg.length});
    const _m=document.getElementById('chatMsgs');
    if(_m){const _c=document.createElement('div');_c.className='cbbl crisis';_c.innerHTML=CRISIS_HTML;_m.appendChild(_c);_m.scrollTop=_m.scrollHeight;}
  }

  document.getElementById('daliFollowup').style.display='none';

  const tid=addTypingBubble();
  const thinkTime=800+Math.min(msg.length*30,1500)+Math.random()*500;
  await new Promise(r=>setTimeout(r,thinkTime));

  try{
    // [보안] 시스템 프롬프트는 서버(openai-proxy/prompts.ts)에서 task='dali_chat' 로 조립.
    //   클라는 데이터 블록(params)과 대화 history 만 전송한다.
    const daliParams=buildDariContext();
    daliParams.history=store.chatHist.slice(-14);
    const data=await callChat('dali_chat',daliParams);
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
    let cardHtml='';
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

      // 해몽 카드 — LLM 값은 esc 로 무해화, 카드는 신뢰 HTML 로 렌더(replaceTypingBubble 3번째 인자)
      cardHtml=`\n<div class="dali-interp-card">
        <div class="dali-interp-header"><span>${dreamType==='길몽'?'☀️':'🌧️'}</span> <b>${esc(dreamTitle)}</b></div>
        <div class="dali-interp-badges"><span class="badge ${dreamType==='길몽'?'bl':'bb'}">${esc(dreamType)}</span> <span class="badge bl">${esc(dreamSymbol)}</span></div>
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
      if(window.showFollowups) setTimeout(()=>window.showFollowups(questions),300);
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
    replaceTypingBubble(tid,reply,cardHtml);
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
      '슬프':'슬픔이 깊을 땐 그냥 곁에 있어주는 게 가장 따뜻해요. 달이가 들어드릴게요 🌙',
      '외로':'혼자 같은 밤이 있어요. 그래도 지금 이 순간 누군가 들어주고 있어요 🐱',
      '불안':'불안은 모르는 것에서 와요. 아는 것부터 한 줄 적어보면 가벼워질 수 있어요',
      '화나':'화는 자기를 지키려는 신호예요. 안전한 표현 방법을 같이 찾아봐요',
      '빡':'빡칠 만한 일이 있었군요. 천천히 깊게 숨 한번 쉬어볼래요? 🐱',
      '무서':'무서운 꿈은 마음이 정리되는 과정이에요. 깨어났다면 이미 안전해요',
      '두려':'두려움은 진짜 위험 알림과 다른 종류일 수 있어요. 함께 살펴봐요',
      '회사':'회사 일이 가끔 무거워질 때가 있어요. 잠깐 멈춰서 호흡해도 괜찮아요',
      '학교':'학교 생활이 어떤가요? 작은 순간도 들어드릴게요',
      '엄마':'엄마와의 시간은 깊은 정서를 남겨요. 어떤 마음이 떠올랐어요?',
      '아빠':'아빠 얘기 들어드릴게요. 천천히 말씀해주세요',
      '연인':'연애 영역은 마음을 가장 많이 흔들어요. 같이 풀어봐요 💗',
      '돈':'돈 걱정은 누구나 가끔 들어요. 어떤 부분이 가장 무거우세요?',
      '시험':'시험 부담은 자기 검증의 무게예요. 점수보다 시도가 답이에요',
      '죽':'죽음을 떠올리는 마음은 변화의 신호일 수 있어요. 어떤 끝과 시작이 떠올랐어요?',
      '좋아':'좋은 마음이 떠오른다는 건 멋진 일이에요 🌸',
      '행복':'그 행복 한 조각 더 자세히 들어볼 수 있을까요? 🌙',
      '기뻐':'기쁨이 함께라 달이도 따뜻해요 ✨',
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
  if(window.updateDariLevel) window.updateDariLevel();

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

// ── 시스템 프롬프트 ──
// [보안: 프롬프트 IP 서버 격리]
export function buildDariContext(){
  const logs=getDreamLogs();
  const mem=getDariMemory();
  const joinDays=getJoinDays();
  const analysis=analyzeDreamData();
  const time=getTimeContext();

  let historyBlock='';
  if(analysis){
    historyBlock=`이 사람의 꿈 이력 (대화에 자연스럽게 녹여서 활용해. "저번에 뱀꿈 꿨었잖아" 이런 식으로):
꿈 ${analysis.total}개 기록함. 이번 주 ${analysis.recent}개.
자주 나오는 키워드: ${analysis.repeats.slice(0,5).map(([k,c])=>k).join(', ')||'아직 없음'}
${analysis.streakSymbol?'최근 '+analysis.streakSymbol+'이 계속 나오고 있어 — 반드시 언급해줘':''}
`;
    if(analysis.recentDreams.length>0){
      historyBlock+='최근에 꾼 꿈들:\n';
      analysis.recentDreams.forEach((l)=>{
        historyBlock+=`- "${l.title}" (${l.date}) — ${(l.text||'').substring(0,60)}\n`;
      });
    }
  }

  let memoryBlock='';
  if(mem.length>0){
    const cats={사실:[],감정:[],패턴:[],조언:[]};
    mem.forEach(m=>{
      if(typeof m==='string'){cats['사실'].push(m);}
      else{(cats[m.cat]||cats['사실']).push('- '+m.text+' ('+m.date+')');}
    });
    const parts=Object.entries(cats).filter(([,v])=>v.length>0).map(([k,v])=>`[${k}]\n${v.join('\n')}`);
    if(parts.length>0) memoryBlock=`달이가 기억하고 있는 것 (${mem.length}개):\n${parts.join('\n')}`;
  }

  let crmBlock='';
  try{
    const ctxData=JSON.parse(localStorage.getItem('mg_dream_context')||'{}');
    const parts=[];
    if(ctxData.lifeStage)parts.push('이 사람은 지금 '+ctxData.lifeStage);
    if(ctxData.currentStress)parts.push('스트레스: '+ctxData.currentStress);
    if(ctxData.relationshipStatus)parts.push('연애 상태: '+ctxData.relationshipStatus);
    if(ctxData.relatedMemory)parts.push('관련 추억: '+ctxData.relatedMemory);
    if(parts.length>0)crmBlock='이 사람에 대해 알고 있는 것 (자연스럽게 활용해):\n'+parts.join('\n');
  }catch{}

  let lastDreamBlock='';
  if(window._last){
    const d=window._last.data;
    lastDreamBlock=`방금 해몽한 꿈: "${d.title}" (${(d.badges||[]).join(', ')})`;
  }

  return {
    name: localStorage.getItem('mg_nickname')||'꿈탐험가',
    joinDays,
    streak: store.streak,
    logsCount: logs.length,
    greeting: time.greeting,
    period: time.period,
    tone: localStorage.getItem('mg_dali_tone')||'friend',
    emotions: store.selectedEmotions||[],
    historyBlock,
    memoryBlock,
    crmBlock,
    lastDreamBlock,
  };
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

export function replaceTypingBubble(id,text,trustedHtml){
  const el=document.getElementById(id);
  if(el){
    el.classList.remove('typing-bubble');
    el.innerHTML=esc(text).replace(/\n/g,'<br>')+(trustedHtml||'');
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

// updBubble 제거 — dead export, 호출부 없음 (2026-06-12)

export function updateDariLevel(){
  // 뱃지 제거됨 — 호출부 호환용으로 빈 함수 유지
}

export function clearChat(){
  if(!confirm('대화 기록을 초기화할까요?'))return;
  store.chatHist=[];localStorage.removeItem('mg_chat_hist');store.dariGreeted=false;
  const msgs=document.getElementById('chatMsgs');
  if(msgs)msgs.innerHTML='';
  document.getElementById('daliFollowup').style.display='none';
  if(window.dariProactiveGreet) window.dariProactiveGreet();
  if(window.renderDaliChips) window.renderDaliChips();
  showToast('대화가 초기화됐어요 🌙');
}

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
    if(window.dariProactiveGreet) window.dariProactiveGreet();
  }
  if(window.renderDaliChips) window.renderDaliChips();
}

// ═══ 꿈 그림 생성 (DALL-E) ═══
async function generateDreamImage(dreamText,dreamTitle,containerId){
  const el=document.getElementById(containerId);
  if(!el)return;
  try{
    logEvent('dream_image_started',{title:dreamTitle});
    const prompt=`Dreamy, ethereal digital illustration of a dream: "${dreamText.substring(0,200)}". Style: soft watercolor, magical night sky with stars, gentle purple and blue tones, whimsical and calming atmosphere. No text, no words.`;
    const data=await callOpenAI('image',{model:'dall-e-3',prompt,n:1,size:'1024x1024',quality:'standard'});
    if(data.data&&data.data[0]&&data.data[0].url){
      el.innerHTML=`<img src="${data.data[0].url}" alt="${esc(dreamTitle)}" class="dali-dream-img-result" onclick="window.open(this.src)">
        <div class="dali-img-caption">🎨 달이가 그린 "${esc(dreamTitle)}"</div>`;
      logEvent('dream_image_completed',{title:dreamTitle});
    }else{
      el.innerHTML='<div class="dali-img-caption" style="color:var(--text-muted)">🎨 그림을 그리지 못했어요</div>';
    }
  }catch(e){
    el.innerHTML='<div class="dali-img-caption" style="color:var(--text-muted)">🎨 그림 생성 중 오류가 발생했어요</div>';
  }
}

// window 노출
window.buildDariContext = buildDariContext;
window.sendChat = sendChat;
window.qChat = qChat;
window.addBubble = addBubble;
window.updateDariLevel = updateDariLevel;
window.clearChat = clearChat;
