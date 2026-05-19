// 몽글몽글 — 해몽 음성 입력 (Web Speech API)
// dream.js 의 voice 영역 분리. ko-KR 음성 인식 + 10초 자동 종료 + 가시성 변경/popstate 시 자동 중단.

import { showToast } from '../components/toast.js';

// 현재 활성 음성 인식 인스턴스 (탭 전환/뒤로가기 시 중단용)
let _activeRecognition=null;
let _voiceTimeout=null;

// 음성 인식 강제 중단 (외부에서 호출 가능)
export function stopVoiceInput(){
  if(_activeRecognition){
    try{_activeRecognition.abort();}catch(e){}
    _activeRecognition=null;
  }
  if(_voiceTimeout){clearTimeout(_voiceTimeout);_voiceTimeout=null;}
  // UI 초기화
  const btn=document.getElementById('voiceBtn');
  const bubble=document.getElementById('voiceBubble');
  if(btn){
    btn.classList.remove('recording');
    const icon=btn.querySelector('.voice-icon');
    if(icon)icon.textContent='🎙';
  }
  if(bubble)bubble.style.display='';
}

export function startVoiceInput(){
  // 이미 녹음 중이면 중단
  if(_activeRecognition){stopVoiceInput();return;}

  // 브라우저 지원 확인
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){
    showToast('이 브라우저에서는 음성 입력을 지원하지 않아요');
    return;
  }

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const rec=new SR();
  rec.lang='ko-KR';rec.continuous=false;rec.interimResults=true;
  _activeRecognition=rec;

  const btn=document.getElementById('voiceBtn');
  const inp=document.getElementById('dreamInput');
  const bubble=document.getElementById('voiceBubble');

  const resetBtn=()=>{
    _activeRecognition=null;
    if(_voiceTimeout){clearTimeout(_voiceTimeout);_voiceTimeout=null;}
    if(btn){
      btn.classList.remove('recording');
      const icon=btn.querySelector('.voice-icon');
      if(icon)icon.textContent='🎙';
    }
    if(bubble)bubble.style.display='';
  };

  // 녹음 상태 UI
  btn.classList.add('recording');
  btn.querySelector('.voice-icon').textContent='⏹';
  if(bubble)bubble.style.display='none';
  showToast('🎙 편하게 말해주세요... 친구한테 얘기하듯이!');

  rec.onresult=(e)=>{
    let text='';
    for(let i=0;i<e.results.length;i++)text+=e.results[i][0].transcript;
    inp.value=text;
    // dream.js 의 updateCharCount → window 글로벌 호출 (분리 모듈 간 의존성 회피)
    if(window.updateCharCount) window.updateCharCount();
  };

  rec.onend=()=>{resetBtn();};

  rec.onerror=(e)=>{
    resetBtn();
    const err=e.error||'';
    if(err==='not-allowed'){
      showToast('음성 입력을 사용하려면 마이크 권한이 필요해요. 브라우저 설정에서 허용해주세요.');
    }else if(err==='no-speech'){
      showToast('음성이 감지되지 않았어요. 다시 시도해주세요');
    }else if(err==='network'){
      showToast('네트워크 오류로 음성 인식에 실패했어요');
    }else if(err==='aborted'){
      // 사용자가 직접 중단하거나 탭 전환으로 중단된 경우 — 조용히 처리
    }else{
      showToast('음성 인식에 실패했어요. 다시 시도해주세요');
    }
  };

  try{
    rec.start();
  }catch(e){
    resetBtn();
    showToast('음성 인식을 시작할 수 없어요. 잠시 후 다시 시도해주세요');
    return;
  }
  _voiceTimeout=setTimeout(()=>{try{rec.stop();}catch(e){}},10000);
}

// 페이지 가시성 변경(뒤로가기/다른 앱 전환) 시 음성 인식 중단
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&_activeRecognition)stopVoiceInput();
});

// 뒤로가기(popstate) 시 음성 인식 중단
window.addEventListener('popstate',()=>{
  if(_activeRecognition)stopVoiceInput();
});
