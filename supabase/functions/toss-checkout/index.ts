// Supabase Edge Function: 토스페이먼츠 결제 준비
// 클라이언트 → 이 함수 → 토스 API → checkout_url 반환 → 클라이언트가 리다이렉트
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY')!
const TOSS_API_URL = 'https://api.tosspayments.com/v1/payments'

/** 토스 API 호출 + 1회 재시도 (1초 대기). 네트워크/5xx 오류만 재시도. */
async function fetchTossWithRetry(url: string, options: RequestInit): Promise<Response> {
  const attempt = async () => fetch(url, options)
  try {
    const res = await attempt()
    if (res.status >= 500) throw new Error(`Toss API ${res.status}`)
    return res
  } catch {
    await new Promise(r => setTimeout(r, 1000))
    return attempt()
  }
}

// 허용된 CORS origin (openai-proxy 와 동일한 allowlist)
const ALLOWED_ORIGINS = new Set<string>([
  'https://baeminkyu9419-beep.github.io',
  'https://monggeul.app',
  'http://localhost:5173',
  'http://localhost:3000',
])

function _buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://baeminkyu9419-beep.github.io'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = _buildCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // CORS allowlist 강제 (openai-proxy 패턴 동일)
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 인증
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 결제 rate-limit: 10회/분 (openai-proxy 30/분보다 엄격)
    const { data: rlOk, error: rlErr } = await supabase.rpc('check_rate_limit', { p_user_id: user.id, p_max: 10 })
    if (rlErr) {
      console.error('check_rate_limit error:', rlErr.message)
    } else if (rlOk === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded (10/min)' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { product_id, order_id, method, order_name, success_url, fail_url } = await req.json()

    if (!product_id || !order_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // [보안] 금액 변조 방지: 클라이언트가 보낸 amount 를 신뢰하지 않고
    //   서버가 products 테이블의 정본 가격을 조회해 사용. (이전엔 클라 amount 그대로 토스 전달)
    const { data: product, error: prodErr } = await supabaseAdmin
      .from('products')
      .select('id, price, name, is_active')
      .eq('id', product_id)
      .eq('is_active', true)
      .single()

    if (prodErr || !product) {
      return new Response(JSON.stringify({ error: '유효하지 않은 상품입니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const amount = product.price  // 정본 가격 — 결제/DB/토스 전부 이 값만 사용

    // DB에 pending 결제 레코드 생성
    await supabaseAdmin.from('payments').insert({
      user_id: user.id,
      order_id,
      pg: 'toss',
      method: method || '카카오페이',
      product_id,
      amount,
      status: 'pending',
    })

    // 토스 결제 준비 API 호출 (1회 재시도 포함)
    const authToken = btoa(TOSS_SECRET_KEY + ':')
    const tossRes = await fetchTossWithRetry(TOSS_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: method || '카카오페이',
        amount,
        orderId: order_id,
        orderName: product.name || order_name || '몽글몽글 해석',
        successUrl: success_url,
        failUrl: fail_url,
        metadata: { user_id: user.id, product_id },
      }),
    })

    const tossData = await tossRes.json()

    if (tossData.checkout?.url) {
      return new Response(JSON.stringify({ checkout_url: tossData.checkout.url }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 간편결제 (카카오/네이버)는 checkout.url 대신 다른 필드일 수 있음
    if (tossData.mobileUrl || tossData.url) {
      return new Response(JSON.stringify({ checkout_url: tossData.mobileUrl || tossData.url }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      error: tossData.message || '토스 결제 준비 실패',
      code: tossData.code,
    }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
