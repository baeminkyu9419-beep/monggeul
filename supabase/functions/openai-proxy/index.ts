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

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''

// 허용된 CORS origin (프로덕션 GitHub Pages + 로컬 개발)
const ALLOWED_ORIGINS = new Set<string>([
  'https://baeminkyu9419-beep.github.io',
  'https://monggeul.app',
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

    // 2. user_id 기반 rate-limit
    if (!_checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded (30 req / 60s)' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. OpenAI 키 확인
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
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
    const { endpoint, payload } = JSON.parse(rawBody)

    // 5. endpoint 화이트리스트
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const url = endpoint === 'chat'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.openai.com/v1/images/generations'

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
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
