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

    const { product_id, order_id, method, amount, order_name, success_url, fail_url } = await req.json()

    if (!product_id || !order_id || !amount) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // DB에 pending 결제 레코드 생성
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

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
        orderName: order_name || '몽글몽글 해석',
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
