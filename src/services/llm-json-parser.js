// 몽글몽글 — LLM(JSON) 견고 파서 (순수 로직, DOM/네트워크 무의존)
//
// [2026-05-23] LLM(JSON) 응답 견고 파싱. Gemini가 코드펜스/앞뒤 산문/문자열 내 raw 제어문자(\n 등)를
// 섞어 보내면 순수 JSON.parse 가 throw → 유료 상세해몽이 demoResult 로 폴백되던 버그 방지.
// 첫 '{' 부터 균형 잡힌 닫는 '}' 까지만 잘라낸다(문자열 내부 따옴표/이스케이프 인지).
// Gemini 가 JSON 뒤에 } 포함 반복 garbage 를 붙여도(예: }\n}\n."\n}) 진짜 객체만 추출.
//
// 추출 이력: src/tabs/dream.js god-func 에서 함수 *이동만* (산식 무변경, coverage-first wave-7).
//   안전망 = tests/test_llm_json_parser_runtime.py (현재 동작 golden + 권위 분리 cross-check).
export function _sliceBalancedJson(s){
  const a=s.indexOf('{'); if(a<0) return s;
  let depth=0, inStr=false, esc=false;
  for(let i=a;i<s.length;i++){
    const ch=s[i];
    if(esc){ esc=false; continue; }
    if(ch==='\\'){ esc=true; continue; }
    if(ch==='"'){ inStr=!inStr; continue; }
    if(inStr) continue;
    if(ch==='{') depth++;
    else if(ch==='}'){ depth--; if(depth===0) return s.slice(a,i+1); }
  }
  return s.slice(a); // 균형 못 찾으면 원본(이후 repair 단계가 처리)
}

export function parseLLMJson(content){
  let s=String(content||'').replace(/```json|```/g,'').trim();
  s=_sliceBalancedJson(s);  // lastIndexOf('}') 대신 균형 매칭 — trailing } garbage 방어
  try{ return JSON.parse(s); }
  catch(_){
    // 제어문자(0x00-0x1F) 중 개행/탭/캐리지리턴만 유효 이스케이프로, 나머지는 제거(소스에 raw 제어문자 없음)
    const ESC={10:"\n",9:"\t",13:"\r"};
    const repaired=s.split("").map(function(ch){var cc=ch.charCodeAt(0);if(cc>31)return ch;return ESC[cc]||"";}).join("");
    return JSON.parse(repaired);
  }
}
