// Supabase Edge Function: Stripe Checkout 세션 생성 (구독 + 단건 팩)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SITE_URL = Deno.env.get('SITE_URL') || 'https://baeminkyu9419-beep.github.io/monggeul'

// 구독 티어별 Stripe Price ID (기존 호환)
const SUBSCRIPTION_PRICE_IDS: Record<string, string> = {
  plus: Deno.env.get('STRIPE_PLUS_PRICE_ID') || '',
  premium: Deno.env.get('STRIPE_PREMIUM_PRICE_ID') || '',
  starlight: Deno.env.get('STRIPE_PLUS_PRICE_ID') || Deno.env.get('STRIPE_STARLIGHT_PRICE_ID') || '',
  starlight_monthly: Deno.env.get('STRIPE_PLUS_PRICE_ID') || '',
}

// 팩 상품별 Stripe Price ID
const PACK_PRICE_IDS: Record<string, string> = {
  pack_1: Deno.env.get('STRIPE_PACK1_PRICE_ID') || '',
  pack_5: Deno.env.get('STRIPE_PACK5_PRICE_ID') || '',
  pack_10: Deno.env.get('STRIPE_PACK10_PRICE_ID') || '',
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

    const body = await req.json()
    // 새 파라미터: product_id, order_id
    // 하위호환: tier 파라미터
    const productId = body.product_id || ''
    const orderId = body.order_id || ''
    const tier = body.tier || ''

    // 팩 상품인지 구독인지 판별
    const isPack = productId.startsWith('pack_')
    let priceId: string
    let mode: string

    if (isPack) {
      priceId = PACK_PRICE_IDS[productId] || ''
      mode = 'payment'
    } else if (productId === 'starlight_monthly' || SUBSCRIPTION_PRICE_IDS[tier]) {
      priceId = SUBSCRIPTION_PRICE_IDS[productId] || SUBSCRIPTION_PRICE_IDS[tier] || ''
      mode = 'subscription'
    } else if (tier) {
      // 하위호환: tier만 전달된 경우
      priceId = SUBSCRIPTION_PRICE_IDS[tier] || ''
      mode = 'subscription'
    } else {
      return new Response(JSON.stringify({ error: 'product_id or tier required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!priceId) {
      return new Response(JSON.stringify({ error: `No Stripe Price configured for: ${productId || tier}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // DB에 pending 결제 레코드 (팩 단건일 때)
    if (isPack && orderId) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabaseAdmin.from('payments').insert({
        user_id: user.id,
        order_id: orderId,
        pg: 'stripe',
        method: 'card',
        product_id: productId,
        amount: body.amount || 0,
        status: 'pending',
      }).catch(() => {})
    }

    // Stripe Checkout 세션 생성
    const params = new URLSearchParams({
      'mode': mode,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'success_url': `${SITE_URL}?checkout=success`,
      'cancel_url': `${SITE_URL}?checkout=cancel`,
      'client_reference_id': user.id,
      'metadata[user_id]': user.id,
      'metadata[product_id]': productId || tier,
      'metadata[order_id]': orderId,
    })

    // subscription에만 tier 메타데이터 (하위호환)
    if (mode === 'subscription') {
      params.set('metadata[tier]', tier || productId)
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await response.json()

    if (session.error) {
      return new Response(JSON.stringify({ error: session.error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
