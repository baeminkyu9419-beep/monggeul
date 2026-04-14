// Supabase Edge Function: 토스페이먼츠 결제 준비 (v2 위젯 방식)
// MID: gbaemiomhk / 사업자: 제과다움
// 역할: orderId 생성 + amount 검증 + payments 테이블에 pending 레코드 삽입 → 클라이언트 반환
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOSS_CLIENT_KEY = Deno.env.get('TOSS_CLIENT_KEY')!
const TOSS_MID = 'gbaemiomhk'

// 상품 ID → 가격 맵 (서버사이드 amount 검증용)
// 클라이언트 PRODUCT_CATALOG (payment.js)와 ID 일치 필수
const PRODUCT_PRICE_MAP: Record<string, number> = {
  pack_1: 1900,              // 상세 해몽 1회
  pack_5: 7900,              // 상세 해몽 5회 팩
  pack_15: 19900,            // 상세 해몽 15회 팩
  unconscious_profile: 2900, // 무의식 프로파일
  pro_monthly: 9900,         // 프로 구독 월정액
}

const PRODUCT_NAME_MAP: Record<string, string> = {
  pack_1: '상세 해몽 1회',
  pack_5: '상세 해몽 5회 팩',
  pack_15: '상세 해몽 15회 팩',
  unconscious_profile: '무의식 프로파일',
  pro_monthly: '몽글몽글 프로 구독',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 인증
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { product_id, amount, success_url, fail_url } = await req.json()

    // product_id 검증
    if (!product_id || !(product_id in PRODUCT_PRICE_MAP)) {
      return new Response(JSON.stringify({ error: '유효하지 않은 상품입니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // amount 서버사이드 검증 (클라이언트 조작 방지)
    const expectedAmount = PRODUCT_PRICE_MAP[product_id]
    if (amount !== expectedAmount) {
      return new Response(JSON.stringify({
        error: '결제 금액이 유효하지 않습니다',
        expected: expectedAmount,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // orderId 생성: MID + 타임스탬프 + 난수 (토스 규격: 6~64자, 영문/숫자/-/_)
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8).toUpperCase()
    const orderId = `${TOSS_MID}-${timestamp}-${random}`

    const orderName = PRODUCT_NAME_MAP[product_id]

    // DB에 pending 결제 레코드 삽입
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error: insertError } = await supabaseAdmin.from('payments').insert({
      user_id: user.id,
      order_id: orderId,
      pg: 'toss',
      method: null,           // 결제 수단은 승인 시 확정됨
      product_id,
      amount,
      status: 'pending',
    })

    if (insertError) {
      return new Response(JSON.stringify({ error: '주문 생성에 실패했습니다', detail: insertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 이벤트 로그
    await supabaseAdmin.from('events').insert({
      user_id: user.id,
      event: 'checkout_started',
      properties: {
        pg: 'toss',
        product_id,
        order_id: orderId,
        amount,
      },
    })

    return new Response(JSON.stringify({
      orderId,
      orderName,
      amount,
      customerEmail: user.email ?? '',
      customerName: user.user_metadata?.full_name ?? '고객',
      mid: TOSS_MID,
      clientKey: TOSS_CLIENT_KEY,
      successUrl: success_url,
      failUrl: fail_url,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
