#!/usr/bin/env node
/**
 * smoke_live.mjs — 배포 후 라이브 작동 스모크 (2026-06-23, 민규 "앞으로 500 없게").
 *
 * 단위 테스트 그린 ≠ 라이브 작동. 2026-06-23 monggeul 프론트는 200인데 핵심 꿈해석
 * 엣지함수가 HTTP 500 으로 깨져 있었다(프론트↔엣지 배포 드리프트). 이 스모크는 실제
 * 배포된 엔드포인트를 사용자처럼 호출해 진짜 작동을 검증한다. deploy:all 마지막 단계.
 *
 * 절차: 라이브 config.js → SUPABASE_URL/anon → 익명세션 → openai-proxy dream_quick
 *       → 200 + 유효 해석(JSON) 이면 통과, 아니면 비0 종료(배포 실패로 간주).
 *
 * 사용: node scripts/smoke_live.mjs  (환경변수 SMOKE_BASE 로 프론트 URL override 가능)
 */
const FRONT = process.env.SMOKE_BASE || "https://baeminkyu9419-beep.github.io/monggeul";

function fail(msg) { console.error("[smoke FAIL] " + msg); process.exit(1); }
function ok(msg) { console.log("[smoke OK] " + msg); }

async function main() {
  // 1) 라이브 config.js 에서 실제 백엔드 좌표 추출
  const cfgRes = await fetch(FRONT + "/config.js");
  if (!cfgRes.ok) fail(`config.js ${cfgRes.status}`);
  const cfg = await cfgRes.text();
  const url = (cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const key = (cfg.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
  if (!url || !key) fail("config.js 에 SUPABASE_URL/ANON_KEY 없음(빌드 주입 실패?)");
  ok(`backend=${url}`);

  // 2) 익명 세션(백엔드 살아있나 + Auth 작동)
  const suRes = await fetch(url + "/auth/v1/signup", {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}",
  });
  if (!suRes.ok) fail(`익명세션 발급 ${suRes.status} — 백엔드 down/Auth 미설정`);
  const token = (await suRes.json()).access_token;
  if (!token) fail("access_token 없음 — Auth 응답 이상");
  ok("anon session 발급");

  // 3) 핵심 기능: dream_quick 실호출 (사용자 동선)
  const dr = await fetch(url + "/functions/v1/openai-proxy", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "chat", task: "dream_quick", params: { input: "하늘을 나는 꿈", lifeStage: "청년" } }),
  });
  const bodyText = await dr.text();
  if (dr.status !== 200) {
    fail(`dream_quick HTTP ${dr.status} — 핵심 기능 깨짐. body=${bodyText.slice(0, 200)}`);
  }
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { fail("dream_quick 응답이 JSON 아님"); }
  // 해석 텍스트가 실제로 들어있는지(LLM 응답 정규화 = choices[].message.content)
  const content = parsed?.choices?.[0]?.message?.content || parsed?.content || "";
  if (!content || content.length < 10) fail("dream_quick 200이나 해석 내용 비어있음(LLM 미작동)");
  ok(`dream_quick 200 + 해석 ${content.length}자`);

  console.log("\n[smoke PASS] monggeul 라이브 핵심 동선(프론트→Auth→꿈해석) 작동 검증됨.");
}

main().catch((e) => fail("예외: " + (e?.message || e)));
