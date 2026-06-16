// 몽글몽글 — 꿈 로또 번호 생성(재미용) — dream.js 에서 추출(2026-06-16, 동작보존).
// 순수 결정론 로직만 보유: LOTTO_FREQ/SYMBOL_NUMBERS 테이블 + getEnergyWeights/
// dreamHash/seededRandom/weightedPick/ballRange/generateLottoNumbers.
// DOM/localStorage/네트워크 무의존(단 generateLottoNumbers 는 new Date() 로 '오늘'을
// 시드에 섞는다 — 기존 동작 그대로). renderLotto/rerollLotto 등 DOM·이벤트 의존부는
// dream.js 에 남아 이 모듈을 import 한다. 단방향(이 모듈 → 무의존), 순환 無.

// 로또 번호 출현 빈도(누적 통계 근사) — 시드 풀 가중치용
export const LOTTO_FREQ={
  34:198,43:196,27:193,1:191,12:190,18:189,33:188,20:187,17:186,14:185,
  45:184,26:183,40:182,7:181,4:180,13:179,10:178,6:177,11:176,3:175,
  37:174,21:173,2:172,15:171,39:170,31:169,24:168,36:167,9:166,44:165,
  35:164,16:163,42:162,38:161,23:160,28:159,29:158,19:157,5:156,22:155,
  41:154,30:153,8:152,25:151,32:150
};

// 꿈 상징→번호 그룹 매핑
export const SYMBOL_NUMBERS={
  뱀:[7,17,27,37],물:[4,14,24,34,44],불:[3,13,23,33,43],하늘:[1,11,21,31,41],
  돈:[8,18,28,38],돼지:[9,19,29,39],이빨:[5,15,25,35,45],달:[6,16,26,36],
  꽃:[2,12,22,32,42],바다:[4,14,34,44],산:[1,11,31,41],새:[3,23,33,43],
  나비:[7,17,27,37],아기:[1,10,20,30],집:[9,19,29,39],차:[6,16,26,36],
  고양이:[2,12,22,32],사랑:[14,24,34,44],죽음:[13,31,43,45],비:[4,24,34,44],
  눈:[1,11,21,41],학교:[5,15,25,35],거미:[8,18,28,38]
};

// 운세 에너지→번호 범위 가중치
export function getEnergyWeights(stats){
  const w=new Array(46).fill(1);
  // 재물운 높으면 고빈도 번호 가중치 UP
  if(stats.재물운>=70) [34,43,27,1,12,18].forEach(n=>w[n]+=3);
  // 연애운 높으면 짝수 번호 가중치
  if(stats.연애운>=70) for(let i=2;i<=44;i+=2)w[i]+=1;
  // 직관 높으면 소수(prime) 가중치
  if(stats.직관>=70) [2,3,5,7,11,13,17,19,23,29,31,37,41,43].forEach(n=>w[n]+=2);
  // 활력 높으면 큰 번호 가중치
  if(stats.활력>=70) for(let i=30;i<=45;i++)w[i]+=1;
  // 건강운 높으면 1의 자리 반복 번호
  if(stats.건강운>=70) [11,22,33,44].forEach(n=>w[n]+=2);
  // 길흉에 따라 조정
  if(stats.길흉>=80) [7,8,18,28,38].forEach(n=>w[n]+=2); // 길한 번호
  if(stats.길흉<40) [4,13,14,44].forEach(n=>w[n]+=1); // 흉한 에너지→반전 행운
  return w;
}

// 입력 텍스트에서 해시 시드 생성
export function dreamHash(text){
  let h=0;
  for(let i=0;i<text.length;i++){h=((h<<5)-h)+text.charCodeAt(i);h|=0;}
  return Math.abs(h);
}

// 의사난수 생성기 (시드 기반)
export function seededRandom(seed){
  let s=seed;
  return function(){s=(s*16807+0)%2147483647;return(s-1)/2147483646;};
}

// 가중치 기반 번호 선택
export function weightedPick(weights,rng,exclude){
  const pool=[];
  for(let n=1;n<=45;n++){
    if(exclude.has(n))continue;
    const freq=LOTTO_FREQ[n]||150;
    const total=weights[n]*freq;
    for(let i=0;i<total;i++)pool.push(n);
  }
  return pool[Math.floor(rng()*pool.length)];
}

// 번호 색상 클래스 (한국 로또 기준)
export function ballRange(n){
  if(n<=10)return 'range1'; // 노란색
  if(n<=20)return 'range2'; // 초록색
  if(n<=30)return 'range3'; // 파란색
  if(n<=40)return 'range4'; // 보라색
  return 'range5'; // 빨간색
}

// 메인 생성 함수
export function generateLottoNumbers(stats,inp){
  const symbols=Object.keys(SYMBOL_NUMBERS);
  const foundSymbols=symbols.filter(s=>inp.includes(s));

  // 시드: 꿈 텍스트 해시 + 오늘 날짜 + stats 합
  const today=new Date().toISOString().split('T')[0];
  const statSum=Object.values(stats).reduce((a,b)=>a+b,0);
  const seed=dreamHash(inp+today)+statSum;
  const rng=seededRandom(seed);

  const weights=getEnergyWeights(stats);

  // 상징 매칭 번호 가중치 추가
  foundSymbols.forEach(sym=>{
    (SYMBOL_NUMBERS[sym]||[]).forEach(n=>{weights[n]+=4;});
  });

  // 6개 번호 선택
  const picked=new Set();

  // 상징 매칭된 번호 중 1개 우선 선택
  if(foundSymbols.length>0){
    const symPool=foundSymbols.flatMap(s=>SYMBOL_NUMBERS[s]||[]);
    if(symPool.length>0){
      const n=symPool[Math.floor(rng()*symPool.length)];
      picked.add(n);
    }
  }

  // 나머지 가중치 기반 선택
  let tries=0;
  while(picked.size<6&&tries<200){
    const n=weightedPick(weights,rng,picked);
    if(n)picked.add(n);
    tries++;
  }

  // 혹시 6개 못 채우면 랜덤 보충
  while(picked.size<6){
    const n=Math.floor(rng()*45)+1;
    picked.add(n);
  }

  const numbers=[...picked].sort((a,b)=>a-b);

  // 분석 텍스트 생성
  let analysis='';
  if(foundSymbols.length>0){
    analysis+=`꿈 속 "${foundSymbols.join(', ')}" 상징에서 핵심 번호를 추출했어요. `;
  }
  const topStat=Object.entries(stats).sort((a,b)=>b[1]-a[1])[0];
  analysis+=`${topStat[0]}(${topStat[1]}점)이 가장 높아서 관련 번호에 가중치를 뒀어요. `;
  analysis+='꿈 상징과 에너지를 반영한 재미용 번호예요 (당첨 보장 없음)';

  return {numbers,analysis,foundSymbols};
}
