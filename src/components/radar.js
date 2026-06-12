// 몽글몽글 — 레이더 차트 (리디자인)

const STAT_EMOJI = { '길흉':'🌙', '연애운':'💕', '재물운':'💰', '건강운':'💚', '활력':'⚡', '직관':'🔮' };
const STAT_COLORS = ['#a67cef','#f8c94c','#f0a8c8','#7de8d8','#f08080','#90d0ff'];

export function drawRadar(stats){
  const svg=document.getElementById('radarSvg');
  svg.innerHTML='';
  const W=240,H=240,cx=120,cy=120,r=85;
  svg.setAttribute('width',W);svg.setAttribute('height',H);
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const labels=Object.keys(stats);
  const n=labels.length;
  const ns='http://www.w3.org/2000/svg';

  // defs
  const defs=document.createElementNS(ns,'defs');
  // 메인 그라데이션
  const grad=document.createElementNS(ns,'radialGradient');
  grad.setAttribute('id','radarGrad');grad.setAttribute('cx','50%');grad.setAttribute('cy','50%');
  const s1=document.createElementNS(ns,'stop');s1.setAttribute('offset','0%');s1.setAttribute('stop-color','#a67cef');s1.setAttribute('stop-opacity','0.4');
  const s2=document.createElementNS(ns,'stop');s2.setAttribute('offset','100%');s2.setAttribute('stop-color','#7c5cbf');s2.setAttribute('stop-opacity','0.08');
  grad.appendChild(s1);grad.appendChild(s2);defs.appendChild(grad);
  // 글로우 필터
  const filter=document.createElementNS(ns,'filter');filter.setAttribute('id','glow');filter.setAttribute('x','-50%');filter.setAttribute('y','-50%');filter.setAttribute('width','200%');filter.setAttribute('height','200%');
  const blur=document.createElementNS(ns,'feGaussianBlur');blur.setAttribute('stdDeviation','3');blur.setAttribute('result','blur');
  const merge=document.createElementNS(ns,'feMerge');
  const m1=document.createElementNS(ns,'feMergeNode');m1.setAttribute('in','blur');
  const m2=document.createElementNS(ns,'feMergeNode');m2.setAttribute('in','SourceGraphic');
  merge.appendChild(m1);merge.appendChild(m2);filter.appendChild(blur);filter.appendChild(merge);defs.appendChild(filter);
  // 보이드 천구 그라데이션 (radarSvg 단일 마운트라 id 고정 안전)
  const vGrad=document.createElementNS(ns,'radialGradient');
  vGrad.setAttribute('id','radarVoid');vGrad.setAttribute('cx','42%');vGrad.setAttribute('cy','36%');vGrad.setAttribute('r','78%');
  [['0%','#181430'],['55%','#100d22'],['100%','#0a0816']].forEach(([o,c])=>{
    const st=document.createElementNS(ns,'stop');st.setAttribute('offset',o);st.setAttribute('stop-color',c);vGrad.appendChild(st);
  });
  defs.appendChild(vGrad);
  svg.appendChild(defs);

  // ── 보이드 천구 배경 — 꿈 에너지가 떠 있는 밤하늘. 별은 stats 합 시드 결정론(같은 꿈=같은 하늘) ──
  const voidDisk=document.createElementNS(ns,'circle');
  voidDisk.setAttribute('cx',cx);voidDisk.setAttribute('cy',cy);voidDisk.setAttribute('r',r+13);
  voidDisk.setAttribute('fill','url(#radarVoid)');
  voidDisk.setAttribute('stroke','rgba(166,124,239,.14)');voidDisk.setAttribute('stroke-width','1');
  svg.appendChild(voidDisk);
  let _t=(labels.reduce((s,k)=>s+(stats[k]|0),0)*7919+n*131)>>>0;
  const _rnd=()=>{_t+=0x6D2B79F5;let q=Math.imul(_t^_t>>>15,1|_t);q^=q+Math.imul(q^q>>>7,61|q);return((q^q>>>14)>>>0)/4294967296;};
  for(let i=0;i<26;i++){
    const a=_rnd()*Math.PI*2, rr=Math.sqrt(_rnd())*(r+9);
    const star=document.createElementNS(ns,'circle');
    star.setAttribute('cx',(cx+rr*Math.cos(a)).toFixed(1));star.setAttribute('cy',(cy+rr*Math.sin(a)).toFixed(1));
    star.setAttribute('r',(0.4+_rnd()*0.6).toFixed(2));star.setAttribute('fill','#e9e4fb');
    if(i%5===0){star.setAttribute('class','radar-star');star.setAttribute('style','animation-delay:'+(_rnd()*3).toFixed(1)+'s');}
    else star.setAttribute('opacity',(0.18+_rnd()*0.4).toFixed(2));
    svg.appendChild(star);
  }

  // 배경 링 (4단계, 점선)
  for(let ring=1;ring<=4;ring++){
    const pts=labels.map((_,i)=>{
      const a=(Math.PI*2*i/n)-Math.PI/2;
      return`${cx+r*(ring/4)*Math.cos(a)},${cy+r*(ring/4)*Math.sin(a)}`;
    }).join(' ');
    const p=document.createElementNS(ns,'polygon');
    p.setAttribute('points',pts);
    p.setAttribute('fill','none');
    p.setAttribute('stroke',ring===4?'rgba(166,124,239,0.2)':'rgba(255,255,255,0.04)');
    p.setAttribute('stroke-width',ring===4?'1':'0.5');
    if(ring<4)p.setAttribute('stroke-dasharray','2,4');
    svg.appendChild(p);
  }

  // 스포크 라인
  labels.forEach((_,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const line=document.createElementNS(ns,'line');
    line.setAttribute('x1',cx);line.setAttribute('y1',cy);
    line.setAttribute('x2',cx+r*Math.cos(a));line.setAttribute('y2',cy+r*Math.sin(a));
    line.setAttribute('stroke','rgba(255,255,255,0.05)');line.setAttribute('stroke-width','0.5');
    svg.appendChild(line);
  });

  // 데이터 폴리곤 (글로우 + 채우기)
  const dpFill=labels.map((k,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2,v=Math.max(stats[k],8)/100;
    return`${cx+r*v*Math.cos(a)},${cy+r*v*Math.sin(a)}`;
  }).join(' ');

  // 글로우 레이어
  const glowPoly=document.createElementNS(ns,'polygon');
  glowPoly.setAttribute('points',dpFill);
  glowPoly.setAttribute('fill','url(#radarGrad)');
  glowPoly.setAttribute('stroke','#a67cef');
  glowPoly.setAttribute('stroke-width','2');
  glowPoly.setAttribute('stroke-linejoin','round');
  glowPoly.setAttribute('filter','url(#glow)');
  glowPoly.setAttribute('opacity','0.8');
  svg.appendChild(glowPoly);

  // 메인 폴리곤
  const mainPoly=document.createElementNS(ns,'polygon');
  mainPoly.setAttribute('points',dpFill);
  mainPoly.setAttribute('fill','url(#radarGrad)');
  mainPoly.setAttribute('stroke','#c8a8ff');
  mainPoly.setAttribute('stroke-width','1.5');
  mainPoly.setAttribute('stroke-linejoin','round');
  svg.appendChild(mainPoly);

  // 데이터 점 (펄스 애니메이션)
  labels.forEach((k,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const v=Math.max(stats[k],8)/100;
    const px=cx+r*v*Math.cos(a),py=cy+r*v*Math.sin(a);

    // 외곽 글로우
    const glow=document.createElementNS(ns,'circle');
    glow.setAttribute('cx',px);glow.setAttribute('cy',py);
    glow.setAttribute('r','6');glow.setAttribute('fill',STAT_COLORS[i]);glow.setAttribute('opacity','0.2');
    svg.appendChild(glow);

    // 메인 점
    const dot=document.createElementNS(ns,'circle');
    dot.setAttribute('cx',px);dot.setAttribute('cy',py);
    dot.setAttribute('r','3.5');dot.setAttribute('fill',STAT_COLORS[i]);
    dot.setAttribute('stroke','#0e0c1a');dot.setAttribute('stroke-width','1.5');
    svg.appendChild(dot);
  });

  // 레이블 (이모지 + 이름 + 수치)
  labels.forEach((k,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const lx=cx+(r+22)*Math.cos(a);
    const ly=cy+(r+22)*Math.sin(a);

    const emoji=STAT_EMOJI[k]||'✦';
    const txt=document.createElementNS(ns,'text');
    txt.setAttribute('x',lx);txt.setAttribute('y',ly-6);
    txt.setAttribute('text-anchor','middle');txt.setAttribute('dominant-baseline','central');
    txt.setAttribute('font-size','13');
    txt.textContent=emoji;
    svg.appendChild(txt);

    const label=document.createElementNS(ns,'text');
    label.setAttribute('x',lx);label.setAttribute('y',ly+8);
    label.setAttribute('text-anchor','middle');label.setAttribute('dominant-baseline','central');
    label.setAttribute('font-size','11');label.setAttribute('font-weight','600');  // [2026-05-23] 폴리시4: 라벨 9→11px 가독성
    label.setAttribute('fill',STAT_COLORS[i]);label.setAttribute('font-family','Noto Sans KR, sans-serif');
    label.textContent=k+' '+stats[k];
    svg.appendChild(label);
  });

  // 중앙 — 에너지 총점
  const total=labels.reduce((s,k)=>s+stats[k],0);
  const avg=Math.round(total/n);
  const grade=avg>=80?'S':avg>=65?'A':avg>=50?'B':avg>=35?'C':'D';
  const gradeColor=avg>=80?'#f8c94c':avg>=65?'#7de8d8':avg>=50?'#c8a8ff':avg>=35?'#f0a8c8':'#f08080';

  const centerBg=document.createElementNS(ns,'circle');
  centerBg.setAttribute('cx',cx);centerBg.setAttribute('cy',cy);
  centerBg.setAttribute('r','20');centerBg.setAttribute('fill','rgba(14,12,26,0.8)');
  centerBg.setAttribute('stroke','rgba(166,124,239,0.3)');centerBg.setAttribute('stroke-width','1');
  svg.appendChild(centerBg);

  const gradeText=document.createElementNS(ns,'text');
  gradeText.setAttribute('x',cx);gradeText.setAttribute('y',cy-2);
  gradeText.setAttribute('text-anchor','middle');gradeText.setAttribute('dominant-baseline','central');
  gradeText.setAttribute('font-size','16');gradeText.setAttribute('font-weight','900');
  gradeText.setAttribute('fill',gradeColor);gradeText.setAttribute('font-family','sans-serif');
  gradeText.textContent=grade;
  svg.appendChild(gradeText);

  const avgText=document.createElementNS(ns,'text');
  avgText.setAttribute('x',cx);avgText.setAttribute('y',cy+12);
  avgText.setAttribute('text-anchor','middle');avgText.setAttribute('dominant-baseline','central');
  avgText.setAttribute('font-size','7');avgText.setAttribute('fill','rgba(200,191,248,0.5)');
  avgText.setAttribute('font-family','sans-serif');
  avgText.textContent=avg+'점';
  svg.appendChild(avgText);

  // 레전드 (2열 그리드) + 툴팁
  const legendEl=document.getElementById('statLegend');
  legendEl.innerHTML=labels.map((k,i)=>{
    const emoji=STAT_EMOJI[k]||'✦';
    const val=stats[k];
    const level=val>=80?'매우 강함':val>=60?'강함':val>=40?'보통':val>=20?'약함':'매우 약함';
    return `<div class="sr radar-tip-trigger" data-stat="${k}" data-val="${val}" style="background:rgba(255,255,255,.03);border-radius:10px;padding:8px 10px;cursor:pointer;position:relative;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:12px">${emoji} <span style="color:${STAT_COLORS[i]};font-weight:700;font-size:11px">${k}</span></span>
        <span style="color:${STAT_COLORS[i]};font-size:13px;font-weight:800">${val}</span>
      </div>
      <div class="sbw" style="height:5px;border-radius:3px"><div class="sb" style="width:0%;background:linear-gradient(90deg,${STAT_COLORS[i]}88,${STAT_COLORS[i]});border-radius:3px;transition:width 1.2s ease ${i*0.12}s;" data-target="${val}"></div></div>
      <div style="font-size:9px;color:var(--text-muted);margin-top:3px">${level}</div>
    </div>`;
  }).join('');

  setTimeout(()=>{document.querySelectorAll('#statLegend .sb[data-target]').forEach(b=>{b.style.width=b.dataset.target+'%';});},150);

  // 툴팁 이벤트
  legendEl.querySelectorAll('.radar-tip-trigger').forEach(el=>{
    const show=()=>showStatTooltip(el,el.dataset.stat,parseInt(el.dataset.val));
    el.addEventListener('click',show);
    el.addEventListener('mouseenter',show);
    el.addEventListener('mouseleave',hideStatTooltip);
  });
}

// ── 에너지 해석 툴팁 ──
const STAT_TIPS={
  '길흉':[[0,25,'주의가 필요한 꿈이에요. 중요한 결정은 며칠 미뤄보세요.'],[26,50,'약간의 불안 요소가 있지만 크게 걱정할 건 아니에요.'],[51,75,'전반적으로 긍정적인 기운이에요.'],[76,100,'아주 좋은 기운의 꿈! 자신감을 가져도 좋아요.']],
  '연애운':[[0,25,'감정적으로 조심해야 할 시기예요.'],[26,50,'관계에 작은 변화가 올 수 있어요.'],[51,75,'사랑의 기운이 감도는 시기예요.'],[76,100,'연애운이 활짝 열렸어요!']],
  '재물운':[[0,25,'지출에 주의하세요.'],[26,50,'소소한 행운이 찾아올 수 있어요.'],[51,75,'재물 흐름이 좋아지고 있어요.'],[76,100,'금전적 행운이 강해요!']],
  '건강운':[[0,25,'몸과 마음 모두 쉼이 필요해요.'],[26,50,'컨디션 관리에 신경 쓰세요.'],[51,75,'전반적으로 양호해요.'],[76,100,'에너지가 넘치는 시기!']],
  '활력':[[0,25,'에너지가 많이 떨어진 상태예요.'],[26,50,'곧 회복할 거예요.'],[51,75,'활기가 돌고 있어요.'],[76,100,'에너지 폭발! 열정을 발휘하세요.']],
  '직관':[[0,25,'판단이 흐려지기 쉬운 시기예요.'],[26,50,'감각이 깨어나고 있어요.'],[51,75,'직감이 예리해지는 시기예요.'],[76,100,'육감이 아주 강해요!']]
};

function getStatTip(stat,val){
  const ranges=STAT_TIPS[stat];if(!ranges)return '';
  const match=ranges.find(([lo,hi])=>val>=lo&&val<=hi);
  return match?match[2]:'';
}

let activeTip=null;
function showStatTooltip(anchor,stat,val){
  hideStatTooltip();
  const tip=document.createElement('div');tip.className='radar-tooltip';
  tip.textContent=getStatTip(stat,val);
  anchor.appendChild(tip);activeTip=tip;
}
function hideStatTooltip(){if(activeTip){activeTip.remove();activeTip=null;}}

export function drawDetailRadar(stats){
  const svg=document.getElementById('detailRadar');svg.innerHTML='';
  const cx=80,cy=80,r=54,labels=Object.keys(stats),n=labels.length;
  const ns='http://www.w3.org/2000/svg';
  for(let rr=1;rr<=4;rr++){const pts=labels.map((_,i)=>{const a=(Math.PI*2*i/n)-Math.PI/2;return`${cx+r*(rr/4)*Math.cos(a)},${cy+r*(rr/4)*Math.sin(a)}`;}).join(' ');const p=document.createElementNS(ns,'polygon');p.setAttribute('points',pts);p.setAttribute('fill','none');p.setAttribute('stroke','rgba(255,255,255,.07)');p.setAttribute('stroke-width','0.5');svg.appendChild(p);}
  labels.forEach((_,i)=>{const a=(Math.PI*2*i/n)-Math.PI/2;const l=document.createElementNS(ns,'line');l.setAttribute('x1',cx);l.setAttribute('y1',cy);l.setAttribute('x2',cx+r*Math.cos(a));l.setAttribute('y2',cy+r*Math.sin(a));l.setAttribute('stroke','rgba(255,255,255,.07)');l.setAttribute('stroke-width','0.5');svg.appendChild(l);});
  const dp=labels.map((k,i)=>{const a=(Math.PI*2*i/n)-Math.PI/2,v=stats[k]/100;return`${cx+r*v*Math.cos(a)},${cy+r*v*Math.sin(a)}`;}).join(' ');
  const poly=document.createElementNS(ns,'polygon');poly.setAttribute('points',dp);poly.setAttribute('fill','rgba(166,124,239,.2)');poly.setAttribute('stroke','#a67cef');poly.setAttribute('stroke-width','1.5');svg.appendChild(poly);
  labels.forEach((k,i)=>{const a=(Math.PI*2*i/n)-Math.PI/2,v=stats[k]/100;const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',cx+r*v*Math.cos(a));dot.setAttribute('cy',cy+r*v*Math.sin(a));dot.setAttribute('r','3');dot.setAttribute('fill',STAT_COLORS[i]);svg.appendChild(dot);});
  document.getElementById('detailStatLegend').innerHTML=labels.map((k,i)=>`<div class="sr"><span class="slabel" style="color:${STAT_COLORS[i]}">${k}</span><div class="sbw"><div class="sb" style="width:${stats[k]}%;background:${STAT_COLORS[i]}"></div></div><span class="sv" style="color:${STAT_COLORS[i]}">${stats[k]}</span></div>`).join('');
}

// ── 레이더 비교 모드: 이번 꿈 vs 평균 오버레이 ──
export function drawRadarCompare(currentStats, avgStats){
  const svg=document.getElementById('radarSvg');
  if(!svg)return;
  // 기존 레이더 먼저 그리기
  drawRadar(currentStats);
  const ns='http://www.w3.org/2000/svg';
  const W=240,cx=120,cy=120,r=85;
  const labels=Object.keys(currentStats);
  const n=labels.length;

  // 평균 폴리곤 (점선, 연한 색)
  const avgPts=labels.map((k,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const v=Math.max(avgStats[k]||0,8)/100;
    return`${cx+r*v*Math.cos(a)},${cy+r*v*Math.sin(a)}`;
  }).join(' ');
  const avgPoly=document.createElementNS(ns,'polygon');
  avgPoly.setAttribute('points',avgPts);
  avgPoly.setAttribute('fill','none');
  avgPoly.setAttribute('stroke','#f8c94c');
  avgPoly.setAttribute('stroke-width','1.5');
  avgPoly.setAttribute('stroke-dasharray','4,3');
  avgPoly.setAttribute('opacity','0.6');
  svg.appendChild(avgPoly);

  // 비교 범례 추가
  const legendEl=document.getElementById('statLegend');
  if(legendEl){
    const compareInfo=document.createElement('div');
    compareInfo.style.cssText='grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:16px;padding:6px 0;font-size:10px;color:var(--text-muted);border-top:1px solid rgba(255,255,255,.06);margin-top:4px';
    compareInfo.innerHTML='<span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:2px;background:#c8a8ff;display:inline-block;border-radius:1px"></span>이번 꿈</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:2px;background:#f8c94c;display:inline-block;border-radius:1px;border-top:1px dashed #f8c94c"></span>최근 평균</span>';
    legendEl.appendChild(compareInfo);

    // 각 항목에 변화량 표시
    labels.forEach((k,i)=>{
      const diff=currentStats[k]-(avgStats[k]||0);
      if(diff===0)return;
      const items=legendEl.querySelectorAll('.sr.radar-tip-trigger');
      if(items[i]){
        const diffEl=document.createElement('div');
        diffEl.style.cssText='font-size:9px;margin-top:2px;font-weight:700;color:'+(diff>0?'#7de8d8':'#f0a8c8');
        diffEl.textContent=(diff>0?'+':'')+diff+' vs 평균';
        items[i].appendChild(diffEl);
      }
    });
  }
}

// ── 두 꿈 나란히 비교 레이더 ──
export function drawDualRadar(containerId, statsA, statsB, labelA, labelB){
  const container=document.getElementById(containerId);
  if(!container)return;
  const W=260,H=260,cx=130,cy=130,r=90;
  container.innerHTML='';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',W);svg.setAttribute('height',H);
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.style.maxWidth='100%';
  const ns='http://www.w3.org/2000/svg';
  const labels=Object.keys(statsA);
  const n=labels.length;

  // 배경 링
  for(let ring=1;ring<=4;ring++){
    const pts=labels.map((_,i)=>{
      const a=(Math.PI*2*i/n)-Math.PI/2;
      return`${cx+r*(ring/4)*Math.cos(a)},${cy+r*(ring/4)*Math.sin(a)}`;
    }).join(' ');
    const p=document.createElementNS(ns,'polygon');
    p.setAttribute('points',pts);p.setAttribute('fill','none');
    p.setAttribute('stroke','rgba(255,255,255,.05)');p.setAttribute('stroke-width','0.5');
    svg.appendChild(p);
  }

  // 스포크
  labels.forEach((_,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const line=document.createElementNS(ns,'line');
    line.setAttribute('x1',cx);line.setAttribute('y1',cy);
    line.setAttribute('x2',cx+r*Math.cos(a));line.setAttribute('y2',cy+r*Math.sin(a));
    line.setAttribute('stroke','rgba(255,255,255,.05)');line.setAttribute('stroke-width','0.5');
    svg.appendChild(line);
  });

  // 꿈 A 폴리곤 (보라)
  const ptsA=labels.map((k,i)=>{const a=(Math.PI*2*i/n)-Math.PI/2;const v=Math.max(statsA[k]||0,5)/100;return`${cx+r*v*Math.cos(a)},${cy+r*v*Math.sin(a)}`;}).join(' ');
  const polyA=document.createElementNS(ns,'polygon');
  polyA.setAttribute('points',ptsA);polyA.setAttribute('fill','rgba(166,124,239,.15)');
  polyA.setAttribute('stroke','#a67cef');polyA.setAttribute('stroke-width','1.5');
  svg.appendChild(polyA);

  // 꿈 B 폴리곤 (금색)
  const ptsB=labels.map((k,i)=>{const a=(Math.PI*2*i/n)-Math.PI/2;const v=Math.max(statsB[k]||0,5)/100;return`${cx+r*v*Math.cos(a)},${cy+r*v*Math.sin(a)}`;}).join(' ');
  const polyB=document.createElementNS(ns,'polygon');
  polyB.setAttribute('points',ptsB);polyB.setAttribute('fill','rgba(248,201,76,.1)');
  polyB.setAttribute('stroke','#f8c94c');polyB.setAttribute('stroke-width','1.5');
  polyB.setAttribute('stroke-dasharray','4,3');
  svg.appendChild(polyB);

  // 레이블
  labels.forEach((k,i)=>{
    const a=(Math.PI*2*i/n)-Math.PI/2;
    const lx=cx+(r+18)*Math.cos(a);const ly=cy+(r+18)*Math.sin(a);
    const t=document.createElementNS(ns,'text');
    t.setAttribute('x',lx);t.setAttribute('y',ly);
    t.setAttribute('text-anchor','middle');t.setAttribute('dominant-baseline','central');
    t.setAttribute('font-size','9');t.setAttribute('fill',STAT_COLORS[i]);
    t.setAttribute('font-weight','600');t.setAttribute('font-family','Noto Sans KR, sans-serif');
    t.textContent=(STAT_EMOJI[k]||'')+' '+k;
    svg.appendChild(t);
  });

  container.appendChild(svg);

  // 범례
  const legend=document.createElement('div');
  legend.style.cssText='display:flex;justify-content:center;gap:16px;margin-top:8px;font-size:10px;color:var(--text-muted)';
  legend.innerHTML='<span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:2px;background:#a67cef;display:inline-block"></span>'+labelA+'</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:2px;background:#f8c94c;display:inline-block;border-top:1px dashed #f8c94c"></span>'+labelB+'</span>';
  container.appendChild(legend);
}

window.drawRadar = drawRadar;
window.drawDetailRadar = drawDetailRadar;
window.drawRadarCompare = drawRadarCompare;
window.drawDualRadar = drawDualRadar;
