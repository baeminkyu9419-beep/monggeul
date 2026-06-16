// 몽글몽글 — XP 레벨/칭호 시스템 — my.js 에서 추출(2026-06-16, 동작보존).
// LEVELS 테이블 + 순수함수 getLevel(xp) 만 보유한다(DOM/localStorage 무의존).
// renderLevelCard/addXP 등 DOM·상태 의존부는 my.js 에 남고 이 모듈을 import 한다.
// 단방향(이 모듈 → 무의존), my.js 로 역의존 없음 → 순환 無.

// ═══ XP 레벨/칭호 시스템 (Phase 2-4) ═══
export const LEVELS=[
  {lv:1,title:'꿈 초보자',emoji:'🌱',minXP:0},
  {lv:2,title:'꿈 탐험가',emoji:'🧭',minXP:50},
  {lv:3,title:'꿈 기록자',emoji:'📖',minXP:150},
  {lv:4,title:'꿈 분석가',emoji:'🔍',minXP:350},
  {lv:5,title:'꿈 해독자',emoji:'🔮',minXP:600},
  {lv:6,title:'꿈 연구가',emoji:'🔬',minXP:1000},
  {lv:7,title:'꿈 마스터',emoji:'🎓',minXP:1500},
  {lv:8,title:'꿈 현자',emoji:'🧙',minXP:2500},
  {lv:9,title:'꿈의 수호자',emoji:'🛡️',minXP:4000},
  {lv:10,title:'꿈의 현인',emoji:'👑',minXP:6000},
];

export function getLevel(xp){
  let lvl=LEVELS[0];
  for(const l of LEVELS){if(xp>=l.minXP)lvl=l;else break;}
  const nextLvl=LEVELS[LEVELS.indexOf(lvl)+1];
  const progress=nextLvl?Math.round((xp-lvl.minXP)/(nextLvl.minXP-lvl.minXP)*100):100;
  return{...lvl,xp,nextXP:nextLvl?nextLvl.minXP:lvl.minXP,progress,nextTitle:nextLvl?nextLvl.title:null};
}
