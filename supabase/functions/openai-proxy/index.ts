// Supabase Edge Function: OpenAI Proxy
// OpenAI API 키를 서버에서만 사용, 클라이언트 노출 방지
//
// Gen113 iter#9.5 VULN_AUDIT Phase B-3-2 패치 [role-guard-bypass]
// 이전: 무인증 — 공격자가 무한 호출 가능 (CRITICAL)
// 이후:
//   1. Supabase JWT (Authorization: Bearer <user_jwt>) 검증
//   2. Origin/Referer 기반 CORS allowlist
//   3. user_id 기반 in-memory rate-limit (30 req / 60s)
//   4. endpoint/payload 화이트리스트 + 페이로드 크기 상한

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { buildChatPayload } from "./prompts.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''

// 멀티 LLM 프로바이더 — Fallback 라우팅(무료) + Consensus 교차검증(프리미엄).
// 키가 설정된 provider 만 활성. 우선순위 = 배열 순서. compatible=true 는 OpenAI 호환 API.
// enabled=false 면 키가 있어도 라우팅에서 제외 (무효 키로 인한 헛호출/401 방지용 플래그).
//
// [2026-05-23] OpenAI 키가 현재 무효(sk-proj-...5w0A → 401 invalid_api_key)라
//   매 해몽마다 OpenAI 우선 호출 → 401 → Gemini 폴백 = 헛호출 + consensus 품질 저하.
//   조치: gemini 를 1차로 고정, openai 는 enabled:false 로 일시 비활성.
//   복구: 유효한 OPENAI_API_KEY 재발급 후 openai 의 enabled 를 true 로 되돌리고
//         원하면 배열 맨 앞으로 이동 (그러면 다시 OpenAI 우선).
interface Provider { name: string; key: string | undefined; model: string; compatible: boolean; url: string; enabled: boolean }
const PROVIDERS: Provider[] = [
  // [2026-05-28] Mistral 추가 — JARVIS_NEW 메모리 박제: Mistral 키 살아있음(F-* providers 실측).
  //   Gemini 키 부재 시 단독으로도 chat 동작. OpenAI 호환 API.
  // [2026-06-05] small→large: 실측(scripts/engine_test.mjs)서 small은 제목 이모지만·영어누출·서식깨짐,
  //   large는 제목 정상·영어0·해석 깊이↑. 해몽 품질이 핵심가치라 large 채택. (운영: 무료티어 RPM 제한 시
  //   paid 전환 또는 gemini 키 복구로 분산. gemini-2.5-flash 도 무료+고품질 대안)
  { name: 'mistral',  key: Deno.env.get('MISTRAL_API_KEY'),  model: 'mistral-large-latest', compatible: true,  url: 'https://api.mistral.ai/v1/chat/completions', enabled: true },
  { name: 'gemini',   key: Deno.env.get('GEMINI_API_KEY'),   model: 'gemini-2.5-flash-lite', compatible: false, url: 'https://generativelanguage.googleapis.com/v1beta/models', enabled: true },
  { name: 'deepseek', key: Deno.env.get('DEEPSEEK_API_KEY'), model: 'deepseek-chat',    compatible: true,  url: 'https://api.deepseek.com/v1/chat/completions', enabled: true },
  { name: 'openai',   key: Deno.env.get('OPENAI_API_KEY'),   model: 'gpt-4o',           compatible: true,  url: 'https://api.openai.com/v1/chat/completions', enabled: false }, // 무효 키 — 복구 시 true
]
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')  // image(DALL-E) 전용
// [2026-05-23] OpenAI 키 무효(401) → DALL-E 꿈 일러스트 호출도 매번 401→retry 헛호출.
//   image 경로를 일시 비활성 (해몽 결과는 일러스트 없이도 정상 렌더 — E2E 확인).
//   복구: 유효 OPENAI_API_KEY 재발급 후 false → true.
const OPENAI_IMAGE_ENABLED = false

// 허용된 CORS origin (프로덕션 GitHub Pages + 로컬 개발)
// 'https://monggeul.app' 제거 — 미등록/비활성 도메인. 실제 라이브 주소는 baeminkyu9419-beep.github.io/monggeul.
// monggeul.app 도메인 취득 후 재추가.
const ALLOWED_ORIGINS = new Set<string>([
  'https://baeminkyu9419-beep.github.io',
  'http://localhost:5173',
  'http://localhost:3000',
])

// 엔드포인트 화이트리스트
const ALLOWED_ENDPOINTS = new Set<string>(['chat', 'image'])

// 페이로드 최대 크기 (16 KB) — 남용 방지
const MAX_PAYLOAD_BYTES = 16 * 1024

// user_id 기반 rate-limit: 60초 창, 30회 상한
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = 30
const _rateMap: Map<string, number[]> = new Map()

function _buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://baeminkyu9419-beep.github.io'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function _checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const arr = _rateMap.get(userId) || []
  // 창 밖의 기록 제거
  const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (fresh.length >= RATE_LIMIT_MAX) {
    _rateMap.set(userId, fresh)
    return false
  }
  fresh.push(now)
  _rateMap.set(userId, fresh)
  return true
}

// 단일 provider 호출 → OpenAI 형식 {choices:[{message:{content}}]} 으로 정규화.
async function _callProvider(p: Provider, payload: any): Promise<any> {
  if (p.compatible) {
    // OpenAI 호환 (OpenAI / DeepSeek): model 만 provider 기본값으로 보정
    const body = { ...payload, model: p.name === 'openai' ? (payload.model || p.model) : p.model }
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.key}` },
      body: JSON.stringify(body),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(`${p.name} ${r.status}: ${JSON.stringify(d).slice(0, 120)}`)
    d._provider = p.name
    return d
  }
  // Gemini: messages → contents 변환, 응답을 OpenAI 형식으로 정규화
  const msgs = payload.messages || []
  const contents = msgs.filter((m: any) => m.role !== 'system').map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const sys = msgs.find((m: any) => m.role === 'system')
  const reqBody: any = {
    contents,
    // 한글 해몽 JSON(1000자+ fullInterpretation)이 잘리지 않도록 넉넉히 + 순수 JSON 강제
    generationConfig: {
      temperature: payload.temperature ?? 0.85,
      maxOutputTokens: Math.max(payload.max_tokens ?? 2048, 8192),
      // JSON 강제는 response_format 요청 시만 (해몽=JSON 파싱 / 달이 채팅=일반 텍스트)
      ...(payload.response_format && payload.response_format.type === 'json_object' ? { responseMimeType: 'application/json' } : {}),
    },
  }
  if (sys) reqBody.systemInstruction = { parts: [{ text: sys.content }] }
  const r = await fetch(`${p.url}/${p.model}:generateContent?key=${p.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(d).slice(0, 120)}`)
  const text = (d?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text).join('')
  return { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], _provider: 'gemini' }
}

// Fallback 라우팅: 우선순위대로 시도, 첫 성공 반환. 전부 실패 시 마지막 에러.
async function _chatFallback(payload: any): Promise<any> {
  const avail = PROVIDERS.filter((p) => p.key && p.enabled)
  if (!avail.length) throw new Error('NO_LLM_KEY')
  let lastErr: any
  for (const p of avail) {
    try { return await _callProvider(p, payload) }
    catch (e) { lastErr = e }
  }
  throw lastErr || new Error('ALL_PROVIDERS_FAILED')
}

// Consensus 교차검증: 상위 2개 동시 호출 → 1번째를 기본, _consensus 에 전체.
async function _chatConsensus(payload: any): Promise<any> {
  const avail = PROVIDERS.filter((p) => p.key && p.enabled).slice(0, 2)
  if (avail.length < 2) return _chatFallback(payload)  // 2개 미만이면 fallback
  const settled = await Promise.allSettled(avail.map((p) => _callProvider(p, payload)))
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s: any) => s.value)
  if (!ok.length) throw new Error('ALL_PROVIDERS_FAILED')
  const primary = ok[0]
  primary._consensus = ok.map((d: any) => ({ provider: d._provider, content: d?.choices?.[0]?.message?.content || '' }))
  return primary
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = _buildCorsHeaders(origin)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // CORS allowlist 강제
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 1. Supabase JWT 검증 (무인증 호출 차단)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'Auth backend not configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. DB 기반 rate-limit (serverless 인스턴스 간 공유 — in-memory _rateMap 은 인스턴스마다 별도라 무력했음)
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', { p_user_id: user.id, p_max: 30 })
    if (rlErr) {
      // RPC 에러는 조용히 삼키지 말고 로깅 (rate limit 우회 방지 디버깅용). 가용성 위해 통과는 유지.
      console.error('check_rate_limit error:', rlErr.message)
    } else if (rlOk === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded (30/min)' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. LLM 키 확인 (chat = 활성 provider 최소 1개, image = OpenAI 필요)
    const hasAnyLLM = PROVIDERS.some((p) => p.key && p.enabled)
    if (!hasAnyLLM && !OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'No LLM key configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. 페이로드 크기 검증
    const rawBody = await req.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { endpoint, payload, mode, task, params } = JSON.parse(rawBody)

    // 5. endpoint 화이트리스트
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6. chat = 멀티 LLM (mode 'consensus' → 교차검증, 기본 → fallback 라우팅)
    //    [보안] 시스템 프롬프트(IP)는 서버에서만 조립한다.
    //    클라이언트는 task + params 만 전송하고, 서버가 buildChatPayload 로 messages(=시스템
    //    프롬프트 포함)를 구성한다. 클라가 보낸 raw payload.messages 는 chat 에서 무시(차단)되어
    //    프롬프트 인젝션·우회 불가.
    if (endpoint === 'chat') {
      if (!task || typeof task !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing task' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const builtPayload = buildChatPayload(task, params)
      if (!builtPayload) {
        return new Response(JSON.stringify({ error: 'Invalid task' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const data = mode === 'consensus' ? await _chatConsensus(builtPayload) : await _chatFallback(builtPayload)
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // image = OpenAI DALL-E 전용 (키 무효 시 OPENAI_IMAGE_ENABLED=false 로 헛호출 차단)
    if (!OPENAI_API_KEY || !OPENAI_IMAGE_ENABLED) {
      return new Response(JSON.stringify({ error: 'Image generation unavailable' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(payload),
    })
    const data = await response.json()
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: response.status,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
