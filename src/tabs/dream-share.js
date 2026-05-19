// 몽글몽글 — 해몽 공유/썸네일
// dream.js 의 share/thumbnail 4 함수 분리. 캔버스 1080x1920 카드 생성 + Web Share + DALL-E 3 이미지.

import { showToast } from '../components/toast.js';
import { logEvent } from '../services/analytics.js';
import { callOpenAI } from '../services/api.js';

export function shareResult(){
  // 바이럴 공유 (레퍼럴 코드 포함)
  if(window._last&&window._last.data&&typeof shareDreamResult==='function'){
    shareDreamResult(window._last.data);
    return;
  }
  logEvent('dream_shared');
  generateShareCard().then(blob=>{
    if(blob&&navigator.share&&navigator.canShare){
      const file=new File([blob],'monggeul_dream.png',{type:'image/png'});
      if(navigator.canShare({files:[file]})){
        navigator.share({title:'몽글몽글 꿈 해몽',text:document.getElementById('rTitle').textContent+' - 몽글몽글에서 해몽!',files:[file]});
        return;
      }
    }
    if(navigator.share)navigator.share({title:'몽글몽글 꿈 해몽',text:document.getElementById('rTitle').textContent+' - 몽글몽글에서 해몽해봤어요!',url:location.href});
    else navigator.clipboard.writeText(location.href).then(()=>showToast('링크 복사됐어요! 📋'));
  });
}

export async function generateShareCard(){
  try{
    const c=document.createElement('canvas');c.width=1080;c.height=1920;
    const ctx=c.getContext('2d');
    const W=1080,H=1920;

    // 배경 — 깊은 밤하늘 그라데이션
    const bg=ctx.createLinearGradient(0,0,W*0.3,H);
    bg.addColorStop(0,'#08061a');bg.addColorStop(0.3,'#150e35');bg.addColorStop(0.6,'#1a1040');bg.addColorStop(1,'#0a0d20');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

    // 성운 효과
    const nebula=ctx.createRadialGradient(W*0.3,H*0.2,0,W*0.3,H*0.2,400);
    nebula.addColorStop(0,'rgba(120,60,180,.12)');nebula.addColorStop(1,'transparent');
    ctx.fillStyle=nebula;ctx.fillRect(0,0,W,H);
    const nebula2=ctx.createRadialGradient(W*0.7,H*0.6,0,W*0.7,H*0.6,350);
    nebula2.addColorStop(0,'rgba(60,40,120,.1)');nebula2.addColorStop(1,'transparent');
    ctx.fillStyle=nebula2;ctx.fillRect(0,0,W,H);

    // 별 — 다양한 크기/색상/밝기
    for(let i=0;i<80;i++){
      const x=Math.random()*W,y=Math.random()*H*0.7;
      const r=Math.random()*2.5+0.5;
      const alpha=0.2+Math.random()*0.6;
      const colors=['255,255,255','255,250,220','255,220,150','200,210,255'];
      const col=colors[Math.floor(Math.random()*colors.length)];
      ctx.fillStyle=`rgba(${col},${alpha})`;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
      if(r>1.8){ctx.fillStyle=`rgba(${col},${alpha*0.3})`;ctx.beginPath();ctx.arc(x,y,r*3,0,Math.PI*2);ctx.fill();}
    }

    // 유성 1개
    ctx.save();ctx.translate(W*0.7,H*0.08);ctx.rotate(-0.6);
    const mg=ctx.createLinearGradient(0,0,200,0);
    mg.addColorStop(0,'rgba(255,240,200,.8)');mg.addColorStop(0.3,'rgba(200,180,255,.4)');mg.addColorStop(1,'transparent');
    ctx.fillStyle=mg;ctx.fillRect(0,-1,200,2);ctx.restore();

    // 제목
    ctx.fillStyle='#f5e6b2';ctx.font='bold 56px sans-serif';ctx.textAlign='center';
    ctx.shadowColor='rgba(245,230,178,.4)';ctx.shadowBlur=20;
    ctx.fillText(document.getElementById('rTitle').textContent||'🌙 해몽 결과',W/2,180);
    ctx.shadowBlur=0;

    // 날짜
    ctx.fillStyle='#8a7eb0';ctx.font='28px sans-serif';
    ctx.fillText(new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'}),W/2,240);

    // 배지
    const badges=(document.getElementById('badgeRow')?.textContent||'').trim();
    if(badges){ctx.fillStyle='#c8bff8';ctx.font='30px sans-serif';ctx.fillText(badges,W/2,300);}

    // 구분선
    const divGrad=ctx.createLinearGradient(W*0.15,0,W*0.85,0);
    divGrad.addColorStop(0,'transparent');divGrad.addColorStop(0.5,'rgba(166,124,239,.4)');divGrad.addColorStop(1,'transparent');
    ctx.fillStyle=divGrad;ctx.fillRect(W*0.15,330,W*0.7,1);

    // 해석 텍스트
    ctx.fillStyle='#c8c0e8';ctx.font='30px sans-serif';ctx.textAlign='left';
    const interp=(document.getElementById('interpText')?.textContent||'').substring(0,300);
    let line='',y=400;
    for(const ch of interp){
      line+=ch;
      if(ctx.measureText(line).width>W-160||ch==='\n'){ctx.fillText(line,80,y);y+=48;line='';if(y>900)break;}
    }
    if(line)ctx.fillText(line,80,y);

    // 스탯 바
    if(window._last&&window._last.data.stats){
      const stats=window._last.data.stats;
      const colors=['#a67cef','#f8c94c','#f0a8c8','#7de8d8','#f08080','#90d0ff'];
      let sy=1050;
      ctx.font='26px sans-serif';
      Object.entries(stats).forEach(([k,v],i)=>{
        ctx.fillStyle='#6b5e8a';ctx.textAlign='left';ctx.fillText(k,80,sy);
        // 바 배경
        ctx.fillStyle='rgba(255,255,255,0.06)';
        const rx=240,rw=660,rh=20,ry=sy-15;
        ctx.beginPath();ctx.roundRect(rx,ry,rw,rh,10);ctx.fill();
        // 바 채우기
        ctx.fillStyle=colors[i%colors.length];
        ctx.beginPath();ctx.roundRect(rx,ry,rw*v/100,rh,10);ctx.fill();
        // 값
        ctx.fillStyle='#f0ecff';ctx.font='bold 24px sans-serif';ctx.textAlign='right';
        ctx.fillText(v+'',W-80,sy);
        ctx.font='26px sans-serif';
        sy+=52;
      });
    }

    // 하단 브랜딩
    ctx.fillStyle=divGrad;ctx.fillRect(W*0.15,H-200,W*0.7,1);
    ctx.fillStyle='rgba(200,191,248,.5)';ctx.font='28px sans-serif';ctx.textAlign='center';
    ctx.fillText('🌙 몽글몽글',W/2,H-150);
    ctx.fillStyle='rgba(248,201,76,.6)';ctx.font='bold 20px sans-serif';
    ctx.fillText('나도 꿈 해몽 해보기 👇',W/2,H-110);
    ctx.fillStyle='rgba(200,191,248,.3)';ctx.font='18px sans-serif';
    ctx.fillText('monggeul.app',W/2,H-75);

    return new Promise(ok=>c.toBlob(ok,'image/png'));
  }catch(e){return null;}
}

export async function generateDreamThumbnail(dreamText){
  try{
    const keywords=dreamText.substring(0,80);
    const data=await callOpenAI('image',{
        model:'dall-e-3',
        prompt:'A dreamy illustration for dream journal. Dream: '+keywords+'. Style: soft purple tones, starry night, mystical. No text.',
        n:1,
        size:'1024x1024',
        quality:'standard'
      });
    return data.data[0].url;
  }catch(e){
    return null;
  }
}

export async function generateResultThumbnail(inp){
  if(!window._last)return;
  const url=await generateDreamThumbnail(inp);
  if(url){
    window._last.thumbnail=url;
    const resultEl=document.getElementById('resultEl');
    const existing=document.getElementById('dreamThumb');
    if(existing)existing.remove();
    const imgDiv=document.createElement('div');
    imgDiv.id='dreamThumb';
    imgDiv.style.cssText='border-radius:16px;overflow:hidden;margin-bottom:14px;border:1px solid rgba(166,124,239,.2);';
    imgDiv.innerHTML=`<img src="${url}" style="width:100%;display:block;border-radius:16px;" alt="꿈 이미지">`;
    const firstCard=resultEl.querySelector('.card');
    if(firstCard)resultEl.insertBefore(imgDiv,firstCard);
  }
}
