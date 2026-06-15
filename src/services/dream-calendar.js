// 몽글몽글 — 꿈 달력 (calendar) — my.js 에서 추출(2026-06-16, 동작보존).
// calYear/calMonth 모듈 상태와 renderCalendar/prevMonth/nextMonth 3함수를 한 모듈로 묶어
// 상태 공유를 유지한다. esc 의존만 가지며 다른 my.js 함수에 역의존 없음(순환 無).
import { esc } from '../utils/sanitize.js';

let calYear=new Date().getFullYear(),calMonth=new Date().getMonth();

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
