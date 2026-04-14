// Patch: "나와 비슷한 꿈" 매칭 (커뮤니티 사례 기반, 로컬)
const fs = require('fs');
const path = require('path');

const commPath = path.join(__dirname, '..', 'src', 'tabs', 'community.js');
let code = fs.readFileSync(commPath, 'utf8');

if (code.includes('renderSimilarDreamsSection')) {
  console.log('SKIP: renderSimilarDreamsSection already exists');
  process.exit(0);
}

const func = `

// ═══ "나와 비슷한 꿈" 매칭 (Phase 2-3) ═══
export function renderSimilarDreamsSection(){
  const el=document.getElementById('similarDreamsSection');
  if(!el)return;

  const logs=JSON.parse(localStorage.getItem('mg_logs')||'[]');
  if(logs.length===0){el.style.display='none';return;}

  // 사용자 최근 꿈 키워드 수집
  const myKws=new Set();
  logs.slice(0,5).forEach(function(l){
    (l.badges||[]).forEach(function(b){myKws.add(b);});
    (l.text||'').split(/\\s+/).forEach(function(w){if(w.length>=2)myKws.add(w);});
  });

  // FEED_DEMO에서 유사도 계산
  const scored=_allFeed.map(function(post){
    var score=0;
    myKws.forEach(function(k){
      if(post.body&&post.body.includes(k))score+=2;
      if(post.tag&&post.tag.includes(k))score+=3;
      if(post.title&&post.title.includes(k))score+=1;
    });
    return{post:post,score:score};
  }).filter(function(s){return s.score>0;}).sort(function(a,b){return b.score-a.score;}).slice(0,3);

  if(scored.length===0){el.style.display='none';return;}

  var esc=function(s){return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  el.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--purple-bright);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span>🔗</span>나와 비슷한 꿈</div>'
    +scored.map(function(s){
      var p=s.post;
      return '<div style="background:rgba(166,124,239,.05);border:1px solid rgba(166,124,239,.12);border-radius:12px;padding:10px;margin-bottom:6px;cursor:pointer" onclick="goToStoryTag(\\''+esc(p.tag||'')+'\\')"><div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:12px;font-weight:600;color:var(--moon)">'+esc(p.title||'')+'</div><span class="badge bl" style="font-size:8px;padding:1px 5px">'+esc(p.tag||'')+'</span></div><div style="font-size:10px;color:var(--text-secondary);margin-top:4px;line-height:1.5">'+esc((p.body||'').substring(0,60))+'...</div><div style="font-size:9px;color:var(--text-muted);margin-top:4px">유사도 '+Math.min(s.score*10,95)+'%</div></div>';
    }).join('');
  el.style.display='block';
}`;

// 파일 끝에 추가
code += func;
fs.writeFileSync(commPath, code, 'utf8');
console.log('DONE: renderSimilarDreamsSection added to community.js');

// HTML 컨테이너 추가
const htmlPath = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('similarDreamsSection')) {
  // 커뮤니티 탭 내부에서 필터 바 아래에 추가
  const anchor = '<div class="feed" id="feedList"></div>';
  if (html.includes(anchor)) {
    html = html.replace(anchor, '<div id="similarDreamsSection" style="display:none;margin-bottom:14px"></div>\n          ' + anchor);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('DONE: similarDreamsSection added to HTML');
  }
}
