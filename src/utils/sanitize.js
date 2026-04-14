// 몽글몽글 — 보안 유틸리티

// HTML 이스케이프 (XSS 방지)
export function esc(str){
  if(typeof str!=='string')return '';
  return str
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// 허용된 태그만 통과 (API 응답용 — strong, br만 허용)
export function sanitize(html){
  if(typeof html!=='string')return '';
  // 먼저 전체 이스케이프
  let safe=esc(html);
  // 허용 태그만 복원
  safe=safe.replace(/&lt;strong&gt;/g,'<strong>');
  safe=safe.replace(/&lt;\/strong&gt;/g,'</strong>');
  safe=safe.replace(/&lt;br&gt;/g,'<br>');
  safe=safe.replace(/&lt;br\/&gt;/g,'<br>');
  safe=safe.replace(/&lt;br \/&gt;/g,'<br>');
  return safe;
}

// URL 검증 (리다이렉트 방지)
export function isValidUrl(url){
  if(typeof url!=='string')return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:';
  }catch{return false;}
}

// API 응답 필드 검증
export function validateDreamResult(data){
  if(!data||typeof data!=='object')return null;
  return {
    title: typeof data.title==='string'?data.title.substring(0,50):'🌙 해몽 결과',
    badges: Array.isArray(data.badges)?data.badges.filter(b=>typeof b==='string').slice(0,5):[],
    stats: validateStats(data.stats),
    emotions: Array.isArray(data.emotions)?data.emotions.filter(e=>typeof e==='string').slice(0,5):[],
    preview: typeof data.preview==='string'?data.preview.substring(0,500):'',
    traditional: typeof data.traditional==='string'?data.traditional.substring(0,1000):'',
    psychology: typeof data.psychology==='string'?data.psychology.substring(0,1000):'',
    advice: typeof data.advice==='string'?data.advice.substring(0,1000):'',
    fullInterpretation: typeof data.fullInterpretation==='string'?data.fullInterpretation.substring(0,3000):'',
  };
}

function validateStats(s){
  if(!s||typeof s!=='object')return {길흉:50,연애운:50,재물운:50,건강운:50,활력:50,직관:50};
  const keys=['길흉','연애운','재물운','건강운','활력','직관'];
  const result={};
  keys.forEach(k=>{
    const v=parseInt(s[k]);
    result[k]=isNaN(v)?50:Math.max(0,Math.min(100,v));
  });
  return result;
}

window.esc = esc;
window.sanitize = sanitize;
