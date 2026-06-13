import{e as r}from"./svc-growth-Dq9GoIyT.js";import{F as $}from"./data-symbols-33vWOqHV.js";let u="7";function I(){document.getElementById("flowPage").classList.add("on"),y()}function F(){document.getElementById("flowPage").classList.remove("on")}function P(n,m){u=n,document.querySelectorAll(".fp-tab").forEach(l=>l.classList.remove("on")),m.classList.add("on"),y()}function y(){const n=parseInt(u),l=JSON.parse(localStorage.getItem("mg_logs")||"[]").filter(t=>!t.noDream).slice(0,n).map(t=>{const o=t.badges||[],c=o.includes("흉몽")?"bad":o.includes("길몽")?"good":"mid",s=[],w=["🐍","🌊","🔥","🦷","☁️","💰","🐷","👻","😰","📝","💔","💩"],M=t.text||"";w.forEach(g=>{M.includes(g)&&s.push(g)}),s.length===0&&s.push("🌙");const E=o.includes("길몽")?70+Math.floor(Math.random()*25):o.includes("흉몽")?15+Math.floor(Math.random()*25):40+Math.floor(Math.random()*30),L={good:"#7de8d8",bad:"#f0a8c8",mid:"#f8c94c"};return{date:t.date||"",title:t.title||"꿈",emo:c,symbols:s,color:L[c],val:E}}),d=l.length>=2?l:$.slice(0,Math.min(n,$.length)),h=document.getElementById("flowEmotionSvg"),v=320,a=100,i=20,e=d.map((t,o)=>{const c=i+o/(d.length-1||1)*(v-i*2),s=a-i-t.val/100*(a-i*2);return{x:c,y:s,d:t}}),p=e.map((t,o)=>o===0?`M${t.x},${t.y}`:`L${t.x},${t.y}`).join(" "),x=`${p} L${e[e.length-1].x},${a} L${e[0].x},${a} Z`;h.innerHTML=`
    <defs>
      <linearGradient id="flowGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#a67cef" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#a67cef" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${x}" fill="url(#flowGrad)"/>
    <path d="${p}" fill="none" stroke="#a67cef" stroke-width="2" stroke-linejoin="round"/>
    ${e.map(t=>`<circle cx="${t.x}" cy="${t.y}" r="4" fill="${t.d.color}" stroke="#0e0c1a" stroke-width="2"/>`).join("")}
    ${e.map(t=>`<text x="${t.x}" y="${a+5}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.3)">${t.d.date}</text>`).join("")}
  `,document.getElementById("flowTimeline").innerHTML=d.map(t=>`
    <div class="ft-item">
      <div class="ft-date-col"><span class="ft-date">${r(t.date)}</span></div>
      <div class="ft-line-col">
        <div class="ft-dot" style="background:${t.color}"></div>
        <div class="ft-vline"></div>
      </div>
      <div class="ft-body">
        <div class="ft-dream-title">${r(t.title)}</div>
        <div class="ft-tags">
          ${t.symbols.map(o=>`<span class="ft-tag ft-emo-${t.emo}">${r(o)}</span>`).join("")}
        </div>
      </div>
    </div>`).join("");const f={};d.forEach(t=>t.symbols.forEach(o=>{f[o]=(f[o]||0)+1}));const b=Object.entries(f).sort((t,o)=>o[1]-t[1]);document.getElementById("flowSymbolCloud").innerHTML=b.map(([t,o])=>`
    <span style="background:rgba(166,124,239,${.1+o*.08});border:1px solid rgba(166,124,239,${.2+o*.1});border-radius:20px;padding:${4+o*2}px ${8+o*3}px;font-size:${12+o*2}px;color:var(--star);cursor:pointer" onclick="showToast(this.dataset.tip)" data-tip="꿈 기록">${r(t)} <span style="font-size:10px;color:var(--text-muted)">${o}회</span></span>`).join("")}export{F as c,I as o,P as s};
