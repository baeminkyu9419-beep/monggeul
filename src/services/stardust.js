// 몽글몽글 — 포인트(별가루) 시스템 — 나중에 상점 BM 연결용
// my.js 에서 추출(2026-06-16, 동작보존). localStorage('mg_stardust' / 'mg_stardust_log') 권위.
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
