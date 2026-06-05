// 로컬 개발 프록시 — Supabase Edge Function(openai-proxy)을 로컬에서 대신한다.
// 실제 prompts.ts dream_quick 조립을 재현해 Mistral 호출 → 클라(api.js)가 그대로 붙어
// engine:'llm' 경로를 end-to-end 로 검증/개발할 수 있게 한다. (프로덕션 배포 전 증명용)
//   실행: node scripts/dev-proxy.mjs   (기본 포트 8787)
//   클라 연결: window.SUPABASE_URL='http://localhost:8787' (config.local.js / .env.local)
import http from 'node:http';
import fs from 'node:fs';

function readKey() {
  for (const p of ['C:/JARVIS_NEW/secrets/.env.shared', 'C:/JARVIS_NEW/secrets/.env']) {
    try { const m = fs.readFileSync(p, 'utf8').match(/^MISTRAL_API_KEY=(.+)$/m); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } catch {}
  }
  return process.env.MISTRAL_API_KEY || '';
}
const KEY = readKey();
const MODEL = process.env.MG_MODEL || 'mistral-large-latest';

function dreamQuickSystem(input) {
  const neg = ['무서', '공포', '불안', '두려', '겁', '슬프', '울', '죽', '쫓', '떨어', '악몽', '가위'];
  const n = neg.filter(w => input.includes(w)).length;
  const tone = n >= 3 ? ' 사용자가 매우 무서운 꿈을 꿔서 불안해해. 위로를 최우선으로.' : n >= 1 ? ' 부정 감정이 포함된 꿈. 공포마케팅 없이 탐색적 톤으로.' : '';
  return `너는 30년 경력 꿈 해석가야. 친구한테 얘기하듯 편하게.${tone}
사용자가 적은 꿈에 실제로 나온 소재에 근거해서만 해석해. 입력에 없는 내용 지어내지 말고 일반론 금지.
[필수] 인물의 성별·관계(전 여자친구/전 남자친구/엄마/상사 등)를 그대로 써. 깬 뒤 감정이 입력에 있으면 핵심으로 짚어.
[출력] title 은 '이모지 1개+공백+한글 단어'. 영어·마크다운 금지. 고인/아픈 주제엔 따뜻한 이모지.
반드시 JSON: {"title":"이모지+한글 10자내","badges":["연애운"],"stats":{"길흉":55,"연애운":40,"재물운":50,"건강운":50,"활력":60,"직관":60},"emotions":["이모지 감정명"],"preview":"3~4문장, 실제 소재+감정 짚고 '이 꿈엔 더 깊은 이야기가 숨어있어요...'로 마무리"}`;
}

function buildPayload(task, params) {
  const input = ((params && params.input) || '').slice(0, 4000);
  if (task === 'dream_quick') {
    return { model: MODEL, messages: [{ role: 'system', content: dreamQuickSystem(input) }, { role: 'user', content: input }], temperature: 0.7, max_tokens: 500, response_format: { type: 'json_object' } };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || !req.url.includes('openai-proxy')) { res.writeHead(404); res.end('not found'); return; }
  let body = ''; for await (const c of req) body += c;
  let parsed; try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
  const payload = buildPayload(parsed.task, parsed.params);
  if (!payload) { res.writeHead(400); res.end(JSON.stringify({ error: 'unknown task' })); return; }
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (d.choices) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...d, model: MODEL })); }
    else { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'provider', detail: d })); }
  } catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })); }
});

const PORT = process.env.PORT || 8787;
if (!KEY) console.log('[dev-proxy] ⚠️ MISTRAL_API_KEY 없음');
server.listen(PORT, () => console.log('[dev-proxy] listening on :' + PORT + ' (model=' + MODEL + ')'));
