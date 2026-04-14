// 몽글몽글 — 토스트 컴포넌트 (의존성 없음)
export function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.remove('on');
  void t.offsetWidth; // 리플로우 강제 — 애니메이션 리셋
  t.classList.add('on');
  clearTimeout(window._toastTimer);
  window._toastTimer=setTimeout(()=>{t.classList.remove('on');},2000);
}

window.showToast = showToast;
