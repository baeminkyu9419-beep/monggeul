// Supabase Edge Function: 토스페이먼츠 결제 승인 (v2)
// MID: gbaemiomhk / 사업자: 제과다움
// 역할: 클라이언트에서 받은 paymentKey+orderId+amount → 토스 승인 API 호출 → DB 업데이트 → 권한 부여
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY')!
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm'

/** 토스 승인 API 호출 + 1회 재시도 (1초 대기). 네트워크/5xx 오류만 재시도. */
async function fetchTossWithRetry(url: string, options: RequestInit): Promise<Response> {
  const attempt = () => fetch(url, options)
  try {
    const res = await attempt()
    if (res.status >= 500) throw new Error(`Toss API ${res.status}`)
    return res
  } catch {
    await new Promise(r => setTimeout(r, 1000))
    return attempt()
  }
}

// 상품 유형별 권한 부여 로직
async function grantEntitlement(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  productId: string,
  paymentId: string,
) {
  // 상품 정보 조회
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single()

  if (!product) return

  if (product.type === 'pack') {
    // 팩: premium_credits 추가
    await supabase.from('entitlements').insert({
      user_id: userId,
      type: 'pack',
      product_id: productId,
      payment_id: paymentId,
      remaining: product.count,
      is_active: true,
    })

    // user_entitlements 하위 호환
    const { data: existing } = await supabase
      .from('user_entitlements')
      .select('premium_credits')
      .eq('user_id', userId)
      .single()

    await supabase.from('user_entitlements').upsert({
      user_id: userId,
      premium_credits: (existing?.premium_credits ?? 0) + product.count,
      updated_at: new Date().toISOString(),
    })

  } else if (product.type === 'one_time') {
    // 단건 구매 (무의식 프로파일 등): 영구 권한 1회
    await supabase.from('entitlements').insert({
      user_id: userId,
      type: 'pack',
      product_id: productId,
      payment_id: paymentId,
      remaining: 1,
      is_active: true,
    })

  } else if (product.type === 'subscription') {
    // 구독: 만료일 설정
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (product.duration_days ?? 30))

    await supabase.from('entitlements').insert({
      user_id: userId,
      type: 'subscription',
      product_id: productId,
      payment_id: paymentId,
      expires_at: expiresAt.toISOString(),
      is_active: true,
    })

    // users 테이블 subscription_tier 갱신
    await supabase.from('users').update({
      subscription_tier: 'pro',
      subscription_expires_at: expiresAt.toISOString(),
    }).eq('id', userId)
  }
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

    const { paymentKey, orderId, amount } = await req.json()

    if (!paymentKey || !orderId || !amount) {
      return new Response(JSON.stringify({ error: '필수 파라미터가 누락되었습니다 (paymentKey, orderId, amount)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // DB에서 pending 주문 조회 및 검증 (이중 결제 방지)
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .single()

    if (paymentError || !payment) {
      return new Response(JSON.stringify({ error: '유효하지 않은 주문입니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // amount 이중 검증 (서버사이드)
    if (payment.amount !== amount) {
      return new Response(JSON.stringify({ error: '결제 금액이 주문 금액과 일치하지 않습니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 토스 결제 승인 API 호출
    const authToken = btoa(TOSS_SECRET_KEY + ':')
    const tossRes = await fetchTossWithRetry(TOSS_CONFIRM_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })

    const tossData = await tossRes.json()

    if (tossData.status === 'DONE') {
      // 결제 성공 → DB 업데이트
      const { data: updatedPayment } = await supabaseAdmin
        .from('payments')
        .update({
          status: 'confirmed',
          payment_key: paymentKey,
          method: tossData.method ?? payment.method,
          raw_response: tossData,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .select('id')
        .single()

      // 권한 부여
      await grantEntitlement(supabaseAdmin, user.id, payment.product_id, payment.id)

      // 이벤트 로그
      await supabaseAdmin.from('events').insert({
        user_id: user.id,
        event: 'checkout_completed',
        properties: {
          pg: 'toss',
          method: tossData.method,
          product_id: payment.product_id,
          order_id: orderId,
          amount,
        },
      })

      return new Response(JSON.stringify({
        success: true,
        product_id: payment.product_id,
        order_id: orderId,
        method: tossData.method,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 승인 실패
    await supabaseAdmin.from('payments').update({
      status: 'failed',
      raw_response: tossData,
    }).eq('id', payment.id)

    return new Response(JSON.stringify({
      success: false,
      error: tossData.message ?? '결제 승인에 실패했습니다',
      code: tossData.code,
    }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
