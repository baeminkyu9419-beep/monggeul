// 꿈 해몽 엔진 품질 테스트 — 실제 dream_quick 프롬프트로 다양한 메시한 꿈을 Mistral에 돌려
// 의도 파악·해석 품질을 눈으로 확인. 프롬프트 튜닝하며 재실행하는 도구.
//   실행: node scripts/engine_test.mjs
import fs from 'node:fs';

function readKey() {
  for (const p of ['C:/JARVIS_NEW/secrets/.env.shared', 'C:/JARVIS_NEW/secrets/.env']) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/^MISTRAL_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return process.env.MISTRAL_API_KEY || '';
}

const MODEL = process.env.MG_MODEL || 'mistral-large-latest';

// ── dream_quick 프롬프트 v2 (출력 안정성 규칙 강화) ──
const SYSTEM = `너는 30년 경력 꿈 해석가야. 친구한테 얘기하듯 편하게.
사용자가 적은 꿈에 실제로 나온 소재(등장인물·장소·사물·행동·감정)에 근거해서만 해석해. 입력에 없는 내용을 지어내지 말고, 누구에게나 들어맞는 일반론·뜬구름 잡는 말 금지. 입력이 짧으면 짧은 대로 그 소재에 집중해.
[필수1] 입력에 나온 인물의 성별·관계(전 여자친구/전 남자친구/엄마/상사 등)를 절대 바꾸지 말고 입력 표현 그대로 써. 꿈에서 깬 뒤의 감정·여운이 입력에 있으면 그것을 해석의 핵심으로 반드시 짚어.
[필수2: 출력 형식] title 은 반드시 '이모지 1개 + 공백 + 한글 단어'(예: "💔 마음의 잔상", "🦷 흔들리는 자신감"). 이모지만 쓰지 마. 한글 제목 필수.
[필수3: 언어] 영어 단어·외국어 절대 금지(lingering 같은 단어 X). 별표(*)·따옴표(„")·마크다운 금지. 자연스러운 한국어 문장만.
[필수4: 톤] 고인·죽음·아픈 주제엔 가벼운/무서운 이모지(👻💥 등) 쓰지 마. 따뜻한 이모지(🌙💗🕊️)만.
[예시] 입력 "돌아가신 할머니가 말없이 밥을 차려주셨고 깨고 한참 울었어요" → {"title":"🕊️ 그리운 밥상","preview":"할머니가 말없이 차려준 밥상은 채워주고 싶은 그리움이에요. 깨고 한참 우셨다는 건 그 그리움이 지금 마음에 크게 자리한다는 뜻이에요. 이 꿈엔 더 깊은 이야기가 숨어있어요..."}
반드시 JSON으로만 응답.
{"title":"이모지 1개+공백+한글 10자내","preview":"3~4문장. 실제 등장 소재 1개+깨어난 감정 짚고 '이 꿈엔 더 깊은 이야기가 숨어있어요...'로 마무리"}`;

const DREAMS = [
  '높은 빌딩에서 떨어졌는데 바닥에 닿기 직전에 깼어요. 요즘 회사 일이 너무 많아서 그런가 싶어요.',
  '돌아가신 아빠가 꿈에 나와서 아무 말 없이 그냥 웃고만 계셨어요. 깨고 나서 마음이 먹먹했어요.',
  '이가 와르르 다 빠지는 꿈인데 너무 생생했어요. 무슨 안 좋은 일 생기려나 무서워요.',
  '누가 계속 쫓아오는데 다리가 안 움직였어요. 깨고도 한참 심장이 두근거렸어요.',
  '시험을 보는데 문제가 하나도 안 읽혔어요. 분명 졸업한 지 오래됐는데 왜 이런 꿈을 꿨을까요.',
  '물속인데 이상하게 숨이 잘 쉬어지고 너무 평화로웠어요.',
];

async function run(user) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    temperature: 0.7, max_tokens: 400, response_format: { type: 'json_object' },
  });
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + readKey() },
    body,
  });
  const d = await r.json();
  try { return JSON.parse(d.choices[0].message.content); }
  catch { return { title: 'PARSE_ERR', preview: JSON.stringify(d).slice(0, 200) }; }
}

const key = readKey();
if (!key) { console.log('MISTRAL_API_KEY 없음'); process.exit(1); }
console.log('엔진 품질 테스트 — Mistral, 다양한 메시한 꿈 ' + DREAMS.length + '개\n');
for (let i = 0; i < DREAMS.length; i++) {
  const o = await run(DREAMS[i]);
  console.log(`━━ 꿈${i + 1}: ${DREAMS[i].slice(0, 40)}...`);
  console.log(`   제목: ${o.title}`);
  console.log(`   해석: ${o.preview}\n`);
}
