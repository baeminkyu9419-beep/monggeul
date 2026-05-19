// 몽글몽글 — 꿈 입력 검증 유틸 (순수 함수)
// dream.js 의 isNonsenseInput 분리. 한글/영어/숫자/특수문자 nonsense 패턴 차단.

export function isNonsenseInput(text){
  const stripped=text.replace(/\s/g,'').replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ]/g,'');
  // 1글자라도 한글이면 통과 (뱀, 꿈 등)
  const korean=(text.match(/[가-힣]/g)||[]).length;
  if(korean>=1&&stripped.length>=1)return false;
  // 내용 없음
  if(stripped.length<2)return true;
  // 같은 문자 반복 (ㅋㅋㅋㅋㅋ, aaaaa 등)
  if(/^(.)\1{4,}$/.test(stripped))return true;
  // 순수 영어만 (dream 같은 단어가 아닌 랜덤 타이핑)
  if(/^[a-zA-Z]+$/.test(stripped)){
    // 모음이 거의 없으면 랜덤 타이핑 (asdfghjkl)
    const vowels=(stripped.match(/[aeiouAEIOU]/g)||[]).length;
    if(vowels/stripped.length<0.15)return true;
    // 의미 있는 영어 단어 체크
    const dreamWords=['dream','snake','fall','fly','teeth','water','fire','die','run','chase','baby','cat','dog','money'];
    if(!dreamWords.some(w=>stripped.toLowerCase().includes(w)))return true;
  }
  // 순수 숫자만
  if(/^\d+$/.test(stripped))return true;
  // 특수문자/자음만 (ㅁㄴㅇㄹ)
  if(korean===0&&!/[a-zA-Z]/.test(stripped)&&stripped.length>0)return true;
  return false;
}
