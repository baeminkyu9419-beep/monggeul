// 몽글몽글 — MY 탭 감정 흐름 (Flow) 영역
// my.js 의 Flow 4 함수 분리. 기간별 (7/30/90일) 감정 흐름 SVG 차트 + 타임라인 + 심볼 클라우드.

import { esc } from '../utils/sanitize.js';
import { FLOW_DEMO } from '../utils/symbols.js';

let flowPeriod='7';

export function openFlowPage(){
  document.getElementById('flowPage').classList.add('on');
  renderFlow();
}
export function closeFlowPage(){document.getElementById('flowPage').classList.remove('on');}

export function setFlowPeriod(p,btn){
  flowPeriod=p;
  document.querySelectorAll('.fp-tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderFlow();
}

export function renderFlow(){
  const days=parseInt(flowPeriod);
  // 실제 사용자 데이터 우선, 없으면 데모
  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]').filter(l=>!l.noDream).slice(0,days);
  const realData=logs.map(l=>{
    const badges=l.badges||[];
    const emo=badges.includes('흉몽')?'bad':badges.includes('길몽')?'good':'mid';
    const symbols=[];
    const dreamSymbols=['🐍','🌊','🔥','🦷','☁️','💰','🐷','👻','😰','📝','💔','💩'];
    const text=l.text||'';
    dreamSymbols.forEach(s=>{if(text.includes(s))symbols.push(s);});
    if(symbols.length===0)symbols.push('🌙');
    const val=badges.includes('길몽')?70+Math.floor(Math.random()*25):badges.includes('흉몽')?15+Math.floor(Math.random()*25):40+Math.floor(Math.random()*30);
    const colors={good:'#7de8d8',bad:'#f0a8c8',mid:'#f8c94c'};
    return {date:l.date||'',title:l.title||'꿈',emo,symbols,color:colors[emo],val};
  });
  const data=realData.length>=2?realData:FLOW_DEMO.slice(0,Math.min(days,FLOW_DEMO.length));

  const svg=document.getElementById('flowEmotionSvg');
  const W=320,H=100,pad=20;
  const pts=data.map((d,i)=>{
    const x=pad+(i/(data.length-1||1))*(W-pad*2);
    const y=H-pad-(d.val/100)*(H-pad*2);
    return {x,y,d};
  });
  const pathD=pts.map((p,i)=>i===0?`M${p.x},${p.y}`:`L${p.x},${p.y}`).join(' ');
  const areaD=`${pathD} L${pts[pts.length-1].x},${H} L${pts[0].x},${H} Z`;
  svg.innerHTML=`
    <defs>
      <linearGradient id="flowGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#a67cef" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#a67cef" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#flowGrad)"/>
    <path d="${pathD}" fill="none" stroke="#a67cef" stroke-width="2" stroke-linejoin="round"/>
    ${pts.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.d.color}" stroke="#0e0c1a" stroke-width="2"/>`).join('')}
    ${pts.map(p=>`<text x="${p.x}" y="${H+5}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.3)">${p.d.date}</text>`).join('')}
  `;

  document.getElementById('flowTimeline').innerHTML=data.map(d=>`
    <div class="ft-item">
      <div class="ft-date-col"><span class="ft-date">${esc(d.date)}</span></div>
      <div class="ft-line-col">
        <div class="ft-dot" style="background:${d.color}"></div>
        <div class="ft-vline"></div>
      </div>
      <div class="ft-body">
        <div class="ft-dream-title">${esc(d.title)}</div>
        <div class="ft-tags">
          ${d.symbols.map(s=>`<span class="ft-tag ft-emo-${d.emo}">${esc(s)}</span>`).join('')}
        </div>
      </div>
    </div>`).join('');

  const symCount={};
  data.forEach(d=>d.symbols.forEach(s=>{symCount[s]=(symCount[s]||0)+1;}));
  const sorted=Object.entries(symCount).sort((a,b)=>b[1]-a[1]);
  document.getElementById('flowSymbolCloud').innerHTML=sorted.map(([s,c])=>`
    <span style="background:rgba(166,124,239,${0.1+c*0.08});border:1px solid rgba(166,124,239,${0.2+c*0.1});border-radius:20px;padding:${4+c*2}px ${8+c*3}px;font-size:${12+c*2}px;color:var(--star);cursor:pointer" onclick="showToast(this.dataset.tip)" data-tip="꿈 기록">${esc(s)} <span style="font-size:10px;color:var(--text-muted)">${c}회</span></span>`).join('');
}
