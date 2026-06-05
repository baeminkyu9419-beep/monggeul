// 실 LLM 경로 end-to-end 증명 — dev-proxy(로컬 Edge Function 대체) 통해 클라 흐름을 재현.
// api.js _proxyFetch + dream.js 의 engine 태깅 로직을 그대로 따라가, 실제 입력이
// engine:'llm', isFallback:false 로 처리되는지 검증한다.
//   사전: node scripts/dev-proxy.mjs (별도 실행 중)
//   실행: node scripts/llm_live_test.mjs
globalThis.window = {};                                  // sanitize.js 의 window.esc= 전역참조 shim
const { validateDreamResult } = await import('../src/utils/sanitize.js');

const ENDPOINT = (process.env.PROXY || 'http://localhost:8787') + '/functions/v1/openai-proxy';
const INPUTS = [
  '졸업했는데 다시 학교에서 시험을 못 치는 꿈을 꿨어요',
  '친구랑 옥상에서 별을 봤는데 갑자기 문이 잠겼어요',
  '전남친이 꿈에 나왔어요',
];

// dream.js analyzeDream 성공경로 재현
async function analyze(input) {
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'chat', task: 'dream_quick', params: { input } }) });
    const data = await r.json();
    if (!data.choices) return { engine: 'fallback_dictionary', isFallback: true, fallbackReason: 'provider_error', detail: data };
    const raw = JSON.parse(data.choices[0].message.content);   // parseLLMJson
    const valid = validateDreamResult(raw);                    // dream.js:215
    if (valid) { valid.engine = 'llm'; valid.isFallback = false; valid.model = data.model || 'llm'; return valid; }
    return { engine: 'fallback_dictionary', isFallback: true, fallbackReason: 'invalid_llm_response' };
  } catch (e) {
    return { engine: 'fallback_dictionary', isFallback: true, fallbackReason: 'llm_call_failed', err: String(e) };
  }
}

let llmCount = 0;
for (const input of INPUTS) {
  const o = await analyze(input);
  console.log('━━ 입력:', input);
  console.log('   engine=' + o.engine + '  isFallback=' + o.isFallback + '  model=' + (o.model || '-') + '  fallbackReason=' + (o.fallbackReason || 'none'));
  console.log('   title=' + (o.title || '-'));
  if (o.preview) console.log('   preview=' + o.preview.slice(0, 110));
  if (o.engine === 'llm') llmCount++;
  console.log('');
  await new Promise(r => setTimeout(r, 3500));               // Mistral 무료티어 RPM 완화
}
console.log(`결과: ${llmCount}/${INPUTS.length} 입력이 engine:"llm", isFallback:false 로 처리됨`);
