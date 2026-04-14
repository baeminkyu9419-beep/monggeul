// ONGLE 연동 — 꿈/운세 블로그 콘텐츠 자동 생성기
// 실행: node scripts/generate-blog-content.js [--output <dir>] [--count <n>] [--format <type>]
// MONGGEUL 상징 데이터 → ONGLE 호환 마크다운 (YAML frontmatter + 본문)

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { EXTENDED_DICT } from '../src/utils/dream-data.js';

// ── CLI 옵션 ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const ONGLE_OUTPUT = getArg('output', 'C:/JARVIS_NEW/projects/ONGLE/output/blog');
const LOCAL_OUTPUT = 'output/blog';
const MAX_COUNT = parseInt(getArg('count', '0'), 10); // 0 = all
const FORMAT = getArg('format', 'all'); // info | guide | list | fortune | all

// ── 날짜 ──
const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ── 블로그 포맷 템플릿 ──

function infoFormat(sym) {
  const tags = buildTags(sym);
  const contexts = sym.contexts.map(c => stripHtml(c.t));
  const top3 = contexts.slice(0, 3);
  const rest = contexts.slice(3, 7);

  return {
    title: `${sym.e} ${sym.n} 꿈 해몽 완벽 정리 — 상황별 의미와 심리 분석`,
    body: `# ${sym.e} ${sym.n} 꿈 해몽 완벽 정리

## ${sym.n} 꿈, 왜 꾸는 걸까?

${sym.meaning}

꿈에서 ${sym.n}이(가) 나타났다면, 당신의 무의식이 중요한 메시지를 보내고 있는 것일 수 있어요. 아래에서 상황별로 자세히 알아볼게요.

## 상황별 ${sym.n} 꿈 해석

${top3.map((c, i) => `### ${i + 1}. ${c.split('→')[0].trim()}\n\n${c.split('→').slice(1).join('→').trim() || c}`).join('\n\n')}

${rest.length > 0 ? `## 더 알아보기\n\n${rest.map(c => `- ${c}`).join('\n')}` : ''}

## 심리학적 관점

융(Jung) 심리학에서 ${sym.n}은(는) ${getCategoryInsight(sym.cat)} 꿈에서 이 상징이 반복된다면, 자신의 내면을 조금 더 들여다볼 필요가 있어요.

## 마무리

꿈 해석은 정답이 아닌 탐색이에요. ${sym.n} 꿈을 꿨다면, 최근 자신의 감정과 상황을 돌아보며 어떤 메시지인지 느껴보세요.

> 더 자세한 AI 꿈 해석이 궁금하다면 [몽글몽글](https://baeminkyu9419-beep.github.io/monggeul)에서 무료로 해몽받아 보세요!`,
    tags,
    desc: `${sym.n} 꿈 해몽 — ${contexts[0]?.slice(0, 60) || sym.meaning.slice(0, 60)}`,
    format: '정보형',
  };
}

function guideFormat(sym) {
  const tags = buildTags(sym);
  const contexts = sym.contexts.map(c => stripHtml(c.t));

  return {
    title: `${sym.n} 꿈 꿨을 때 해석하는 법 — 3단계 셀프 해몽 가이드`,
    body: `# ${sym.n} 꿈 꿨을 때 해석하는 법

${sym.n} 꿈을 꿨나요? 아래 3단계로 스스로 해몽해 보세요.

## STEP 1. 꿈의 감정 확인하기

꿈에서 어떤 감정을 느꼈나요? ${sym.n}이(가) 나타났을 때의 감정이 해석의 핵심 열쇠예요.

- **무섭거나 불안했다면** → 직면하지 못한 감정이나 회피하는 문제가 있을 수 있어요
- **편안하거나 기뻤다면** → 긍정적 변화나 좋은 기운이 다가오고 있어요
- **신기하거나 무덤덤했다면** → 무의식이 탐색 중이에요. 천천히 지켜보세요

## STEP 2. 상황별 의미 매칭하기

${sym.meaning}

아래에서 당신의 꿈과 가장 가까운 상황을 찾아보세요:

${contexts.slice(0, 5).map((c, i) => `**${i + 1}.** ${c}`).join('\n\n')}

## STEP 3. 현실 상황과 연결하기

꿈은 현실의 거울이에요. 최근 당신의 생활에서 이런 키워드가 있었나요?

${getLifeQuestions(sym.cat)}

이 질문들에 대한 답이 곧 꿈의 메시지예요.

## 셀프 해몽이 어렵다면?

AI가 맥락까지 분석해서 맞춤 해석을 제공해 드려요. [몽글몽글에서 해몽받기](https://baeminkyu9419-beep.github.io/monggeul)`,
    tags,
    desc: `${sym.n} 꿈 해석법 — 감정 확인부터 현실 연결까지 3단계 셀프 해몽 가이드`,
    format: '가이드형',
  };
}

function listFormat(sym) {
  const tags = buildTags(sym);
  const contexts = sym.contexts.map(c => stripHtml(c.t));
  const items = contexts.slice(0, 7);

  return {
    title: `${sym.n} 꿈 해몽 TOP ${items.length} — 상황별 의미 총정리`,
    body: `# ${sym.n} 꿈 해몽 TOP ${items.length}

${sym.e} ${sym.n} 꿈, 어떤 의미일까요? 가장 많이 검색되는 상황별로 정리했어요.

${items.map((c, i) => {
  const parts = c.split('→');
  const heading = parts[0].trim();
  const detail = parts.slice(1).join('→').trim() || c;
  return `## ${i + 1}위. ${heading}\n\n${detail}`;
}).join('\n\n')}

## 정리

| 순위 | 상황 | 해석 |
|------|------|------|
${items.map((c, i) => {
  const parts = c.split('→');
  return `| ${i + 1} | ${parts[0].trim()} | ${(parts[1] || '').trim().slice(0, 40)}... |`;
}).join('\n')}

---

${sym.n} 꿈의 의미는 꿈속 감정과 현실 상황에 따라 달라져요. AI 맞춤 해석이 궁금하다면 [몽글몽글](https://baeminkyu9419-beep.github.io/monggeul)을 이용해 보세요!`,
    tags,
    desc: `${sym.n} 꿈 해몽 인기 TOP ${items.length} — 상황별 해석과 의미 총정리`,
    format: '리스트형',
  };
}

function fortuneFormat(sym) {
  const tags = [...buildTags(sym).split(', '), '#오늘의운세', '#꿈운세'];
  const isGood = sym.tags.includes('길몽') || sym.tags.includes('대길');
  const contexts = sym.contexts.map(c => stripHtml(c.t));

  return {
    title: `${sym.e} ${sym.n} 꿈을 꿨다면? 오늘의 운세와 행운 포인트`,
    body: `# ${sym.e} ${sym.n} 꿈을 꿨다면? 오늘의 운세

## 꿈 운세 결과

${isGood
  ? `${sym.n} 꿈은 전통적으로 **길몽**으로 해석돼요! 오늘은 특히 좋은 기운이 함께하는 날이에요.`
  : `${sym.n} 꿈은 주의가 필요하다는 무의식의 신호예요. 하지만 꿈은 경고이지 예언이 아니에요. 오히려 미리 대비할 수 있는 기회랍니다.`}

### ${sym.n} 꿈의 기본 의미

${sym.meaning}

## 오늘의 행운 포인트

| 항목 | 내용 |
|------|------|
| 행운의 색 | ${getLuckyColor(sym)} |
| 행운의 숫자 | ${getLuckyNumbers()} |
| 행운의 방향 | ${getLuckyDirection()} |
| 오늘의 조언 | ${isGood ? '적극적으로 행동하세요' : '신중하게 판단하세요'} |

## 상황별 운세

${contexts.slice(0, 4).map(c => `- ${c}`).join('\n')}

## 이번 주 꿈 트렌드

최근 ${sym.n} 꿈을 검색하는 분들이 늘고 있어요. ${getCategoryTrend(sym.cat)}

---

> 매일 꿈을 기록하면 무의식의 패턴이 보여요. [몽글몽글](https://baeminkyu9419-beep.github.io/monggeul)에서 꿈 일기를 시작해 보세요!`,
    tags: tags.join(', '),
    desc: `${sym.n} 꿈 운세 — ${isGood ? '길몽!' : '주의 필요'} 오늘의 행운 포인트와 상황별 해석`,
    format: '운세형',
  };
}

// ── 헬퍼 함수 ──

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

function buildTags(sym) {
  const base = [`#${sym.n}꿈`, '#꿈해몽', '#꿈해석', `#${sym.cat}`];
  if (sym.tags.includes('길몽')) base.push('#길몽');
  if (sym.tags.includes('대길')) base.push('#대길몽');
  if (sym.tags.includes('주의')) base.push('#주의');
  base.push('#몽글몽글');
  return base.join(', ');
}

function getCategoryInsight(cat) {
  const map = {
    '동물': '본능, 무의식적 욕구, 또는 자아의 원형적 측면을 나타내요.',
    '사람': '관계에 대한 내면의 투영이자 자아의 다른 측면이에요.',
    '자연': '감정의 흐름과 내적 에너지의 상태를 반영해요.',
    '사물': '일상의 도구이자, 무의식이 현실 문제를 처리하는 방식을 보여줘요.',
    '장소': '마음의 공간과 현재 심리적 위치를 상징해요.',
    '상황': '현재 삶에서 겪고 있는 심리적 테마를 반영해요.',
    '신체': '자아 이미지와 자기 인식의 변화를 나타내요.',
    '감정': '처리되지 않은 감정이 꿈을 통해 표현되는 거예요.',
  };
  return map[cat] || '내면의 중요한 메시지를 담고 있어요.';
}

function getLifeQuestions(cat) {
  const map = {
    '동물': '- 최근 본능적으로 피하고 싶은 일이 있나요?\n- 자유롭게 행동하고 싶은 욕구가 있나요?\n- 누군가에 대한 경계심이 있나요?',
    '사람': '- 특정 사람과의 관계에서 고민이 있나요?\n- 자신의 어떤 면을 인정하기 어려운가요?\n- 새로운 만남이나 이별이 있었나요?',
    '자연': '- 감정의 기복이 심한 시기인가요?\n- 새로운 시작을 앞두고 있나요?\n- 내면의 에너지가 어떤 상태인가요?',
    '사물': '- 해결해야 할 현실적 문제가 있나요?\n- 새로운 도구나 방법이 필요한가요?\n- 무언가를 잃거나 놓치고 있진 않나요?',
    '장소': '- 현재 위치(직장, 관계)에 만족하나요?\n- 새로운 환경으로 이동을 고려 중인가요?\n- 내면의 안식처가 필요한가요?',
    '상황': '- 큰 결정을 앞두고 있나요?\n- 통제할 수 없는 상황에 처해 있나요?\n- 변화가 두렵거나 기대되나요?',
  };
  return map[cat] || '- 최근 마음에 걸리는 일이 있나요?\n- 변화를 원하고 있나요?\n- 무언가를 회피하고 있진 않나요?';
}

function getLuckyColor(sym) {
  const colors = {
    '길몽': '금색, 노란색',
    '대길': '금색, 빨간색',
    '주의': '파란색, 흰색',
    '중립': '초록색, 보라색',
  };
  return colors[sym.tags[0]] || '흰색, 하늘색';
}

function getLuckyNumbers() {
  const nums = new Set();
  while (nums.size < 3) nums.add(Math.floor(Math.random() * 45) + 1);
  return [...nums].sort((a, b) => a - b).join(', ');
}

function getLuckyDirection() {
  const dirs = ['동쪽', '서쪽', '남쪽', '북쪽', '동남쪽', '서북쪽'];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function getCategoryTrend(cat) {
  const map = {
    '동물': '동물 꿈은 계절 변화나 스트레스 시기에 특히 많이 꾸는 유형이에요.',
    '사람': '사람 관련 꿈은 관계 변화가 많은 시기에 급증하는 경향이 있어요.',
    '자연': '자연 꿈은 감정적 전환기에 자주 나타나는 보편적인 꿈이에요.',
    '사물': '사물 꿈은 현실 문제에 집중하고 있을 때 자주 나타나요.',
    '장소': '장소 꿈은 환경 변화(이사, 이직)를 앞둔 시기에 많이 꿔요.',
    '상황': '상황 꿈은 중요한 결정을 앞둔 시기에 자주 나타나는 유형이에요.',
  };
  return map[cat] || '이 유형의 꿈은 내면의 변화를 반영하는 경우가 많아요.';
}

// ── 마크다운 생성 ──

function toMarkdown({ title, body, tags, desc, format }, sym) {
  const imagePrompt = `Dreamy watercolor illustration of ${sym.n} (${sym.e}) in a mystical moonlit scene, soft purple and blue tones, Korean dream interpretation concept art`;

  return `---
title: "${title}"
tags: ${tags}
meta_description: "${desc.slice(0, 155)}"
image_prompt: "${imagePrompt}"
platform: tistory
source: monggeul
source_symbol: "${sym.n}"
source_category: "${sym.cat}"
format: "${format}"
created: ${now.toISOString()}
status: draft
---

${body}
`;
}

// ── 메인 실행 ──

const formatMap = {
  info: infoFormat,
  guide: guideFormat,
  list: listFormat,
  fortune: fortuneFormat,
};

const formats = FORMAT === 'all'
  ? Object.entries(formatMap)
  : [[FORMAT, formatMap[FORMAT]]].filter(([, fn]) => fn);

if (formats.length === 0) {
  console.error(`Unknown format: ${FORMAT}. Use: info, guide, list, fortune, or all`);
  process.exit(1);
}

let symbols = EXTENDED_DICT.filter(s => s.contexts && s.contexts.length >= 3);
if (MAX_COUNT > 0) symbols = symbols.slice(0, MAX_COUNT);

const outDir = `${LOCAL_OUTPUT}/${dateStr}`;
mkdirSync(outDir, { recursive: true });

let generated = 0;

for (const sym of symbols) {
  for (const [fmtName, fmtFn] of formats) {
    const data = fmtFn(sym);
    const md = toMarkdown(data, sym);
    const safeName = sym.n.replace(/[/\\:*?"<>|]/g, '_');
    const slug = `${timestamp}_${safeName}_${fmtName}`;
    const filename = `${slug}.md`;

    writeFileSync(`${outDir}/${filename}`, md, 'utf-8');
    generated++;
  }
}

// ONGLE 출력 (디렉토리 존재 시)
let ongleSynced = 0;
if (existsSync(ONGLE_OUTPUT)) {
  const ongleDir = `${ONGLE_OUTPUT}/${dateStr}`;
  mkdirSync(ongleDir, { recursive: true });

  for (const sym of symbols) {
    for (const [fmtName, fmtFn] of formats) {
      const data = fmtFn(sym);
      const md = toMarkdown(data, sym);
      const safeName = sym.n.replace(/[/\\:*?"<>|]/g, '_');
      const slug = `${timestamp}_${safeName}_${fmtName}`;
      writeFileSync(`${ongleDir}/${slug}.md`, md, 'utf-8');
      ongleSynced++;
    }
  }
}

console.log(`\n  MONGGEUL → ONGLE Blog Content Generator`);
console.log(`  ─────────────────────────────────────────`);
console.log(`  Symbols: ${symbols.length}`);
console.log(`  Formats: ${formats.map(([n]) => n).join(', ')}`);
console.log(`  Generated: ${generated} files → ${outDir}/`);
if (ongleSynced > 0) {
  console.log(`  ONGLE sync: ${ongleSynced} files → ${ONGLE_OUTPUT}/${dateStr}/`);
} else {
  console.log(`  ONGLE sync: skipped (${ONGLE_OUTPUT} not found)`);
}
console.log(`  Done!\n`);
