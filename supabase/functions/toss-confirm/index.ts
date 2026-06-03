// Supabase Edge Function: 토스페이먼츠 결제 승인
// 사용자가 결제 완료 후 리다이렉트 → 클라이언트가 이 함수 호출 → 토스 승인 API → DB 업데이트
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY')!
const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm'

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

    const { paymentKey, orderId, amount } = await req.json()

    if (!paymentKey || !orderId || !amount) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 주문 검증: DB의 pending 레코드와 금액 일치 확인
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .single()

    if (!payment) {
      return new Response(JSON.stringify({ error: '유효하지 않은 주문입니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (payment.amount !== amount) {
      return new Response(JSON.stringify({ error: '결제 금액이 일치하지 않습니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 토스 결제 승인 API 호출 (1회 재시도 포함)
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
      await supabaseAdmin.from('payments').update({
        status: 'confirmed',
        payment_key: paymentKey,
        method: tossData.method || payment.method,
        raw_response: tossData,
        confirmed_at: new Date().toISOString(),
      }).eq('id', payment.id)

      // 상품 정보 조회
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', payment.product_id)
        .single()

      if (product) {
        if (product.type === 'pack') {
          // 팩: 크레딧 부여
          await supabaseAdmin.from('entitlements').insert({
            user_id: user.id,
            type: 'pack',
            product_id: product.id,
            payment_id: payment.id,
            remaining: product.count,
            is_active: true,
          })

          // 기존 user_entitlements 하위호환
          const { data: existing } = await supabaseAdmin
            .from('user_entitlements')
            .select('premium_credits')
            .eq('user_id', user.id)
            .single()

          const currentCredits = existing?.premium_credits ?? 0
          await supabaseAdmin.from('user_entitlements').upsert({
            user_id: user.id,
            premium_credits: currentCredits + product.count,
            updated_at: new Date().toISOString(),
          })
        } else if (product.type === 'one_time') {
          // 단건 구매 (무의식 프로파일 등): 영구 권한 1회 부여
          await supabaseAdmin.from('entitlements').insert({
            user_id: user.id,
            type: 'pack',
            product_id: product.id,
            payment_id: payment.id,
            remaining: 1,
            is_active: true,
          })
        } else if (product.type === 'subscription') {
          // 구독: 기간 부여
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + (product.duration_days || 30))

          await supabaseAdmin.from('entitlements').insert({
            user_id: user.id,
            type: 'subscription',
            product_id: product.id,
            payment_id: payment.id,
            expires_at: expiresAt.toISOString(),
            is_active: true,
          })

          // users 테이블 tier 갱신 (구 toss-payment-confirm v2 에서 통합)
          await supabaseAdmin.from('users').update({
            subscription_tier: 'pro',
            subscription_expires_at: expiresAt.toISOString(),
          }).eq('id', user.id)
        }
      }

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

      return new Response(JSON.stringify({ success: true, product_id: payment.product_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 승인 실패
    await supabaseAdmin.from('payments').update({
      status: 'failed',
      raw_response: tossData,
    }).eq('id', payment.id)

    return new Response(JSON.stringify({
      success: false,
      error: tossData.message || '결제 승인에 실패했습니다',
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
