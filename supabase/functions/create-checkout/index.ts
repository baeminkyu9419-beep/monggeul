// Supabase Edge Function: Stripe Checkout 세션 생성 (구독 + 단건 팩)
//
// Gen113 iter#9.5 VULN_AUDIT Phase B-3-5 패치 [role-guard-bypass]
// 이전: body.amount 를 그대로 payments.amount 에 insert (결제 조작 가능)
// 이후: 서버측 하드코딩 SKU 가격표로 검증. 불일치 시 400.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const SITE_URL = Deno.env.get('SITE_URL') || 'https://baeminkyu9419-beep.github.io/monggeul'

// 정본 SKU 집합 (payment.js PRODUCT_CATALOG + DB migration 20260407_reconcile_products 동기)
//   구독:  pro_monthly(=plus alias) / plus_monthly / premium_monthly
//   팩:    pack_1 / pack_5 / pack_15
//   단건:  unconscious_profile (one_time)
// 레거시 키(plus/pro/premium/starlight/pack_10)는 SKU_ALIAS 로 정본화 후 조회.

// 레거시 SKU·tier → 정본 SKU 별칭 (payment.js SKU_ALIAS 와 동기)
const SKU_ALIAS: Record<string, string> = {
  pro: 'pro_monthly',                 // pg-stripe.js 레거시 tier ('pro')
  plus: 'plus_monthly',               // checkout.js 레거시 tier
  premium: 'premium_monthly',
  starlight: 'plus_monthly',          // 구 Starlight = Plus
  starlight_monthly: 'plus_monthly',
}
const resolveSku = (s: string): string => SKU_ALIAS[s] || s

// 서버측 하드코딩 SKU → 원화 가격 표 (클라이언트 body.amount 신뢰 금지)
// 키는 정본 SKU 만 사용 (별칭은 resolveSku 로 통일된 뒤 조회)
const _SKU_PRICE_TABLE: Record<string, number> = {
  // 구독 (월)
  'pro_monthly': 9900,        // 레거시 = Plus 동의어
  'plus_monthly': 3900,
  'premium_monthly': 19900,
  // 팩 (단건)
  'pack_1': 1900,
  'pack_5': 7900,
  'pack_15': 19900,
  // 단건 one_time
  'unconscious_profile': 2900,
}

// 구독 SKU별 Stripe Price ID (정본 키)
const SUBSCRIPTION_PRICE_IDS: Record<string, string> = {
  pro_monthly: Deno.env.get('STRIPE_PLUS_PRICE_ID') || '',   // pro = plus alias → 동일 Price
  plus_monthly: Deno.env.get('STRIPE_PLUS_PRICE_ID') || '',
  premium_monthly: Deno.env.get('STRIPE_PREMIUM_PRICE_ID') || '',
}

// 팩·단건 SKU별 Stripe Price ID (정본 키)
const PACK_PRICE_IDS: Record<string, string> = {
  pack_1: Deno.env.get('STRIPE_PACK1_PRICE_ID') || '',
  pack_5: Deno.env.get('STRIPE_PACK5_PRICE_ID') || '',
  pack_15: Deno.env.get('STRIPE_PACK15_PRICE_ID') || '',
  unconscious_profile: Deno.env.get('STRIPE_PROFILE_PRICE_ID') || '',
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

    // 정본 SKU 결정 (product_id 우선, 없으면 레거시 tier) — 별칭 통일
    const rawSku = productId || tier
    if (!rawSku) {
      return new Response(JSON.stringify({ error: 'product_id or tier required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const sku = resolveSku(rawSku)

    // 팩/단건(one_time) = 1회 결제, 그 외 = 구독
    const isPack = sku.startsWith('pack_')
    const isOneTime = sku === 'unconscious_profile'
    let priceId: string
    let mode: string
    if (isPack || isOneTime) {
      priceId = PACK_PRICE_IDS[sku] || ''
      mode = 'payment'
    } else {
      priceId = SUBSCRIPTION_PRICE_IDS[sku] || ''
      mode = 'subscription'
    }

    if (!priceId) {
      return new Response(JSON.stringify({ error: `No Stripe Price configured for: ${sku}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Gen113 iter#9.5 VULN_AUDIT Phase B-3-5 패치 [role-guard-bypass]
    // 서버측 가격 검증 — 클라이언트 body.amount 무시, SKU 테이블 가격으로 덮어쓰기
    const serverSidePrice = _SKU_PRICE_TABLE[sku]
    if (serverSidePrice === undefined) {
      return new Response(JSON.stringify({ error: `Unknown product SKU: ${sku}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // 클라이언트가 amount 를 보냈다면 일치 여부 검증 (일치 안 하면 400)
    if (body.amount !== undefined && body.amount !== null) {
      const clientAmount = Number(body.amount)
      if (!Number.isFinite(clientAmount) || clientAmount !== serverSidePrice) {
        return new Response(JSON.stringify({
          error: 'Amount mismatch with server-side price',
          server_price: serverSidePrice,
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // DB에 pending 결제 레코드 (팩 + one_time 단건일 때) — amount 는 항상 serverSidePrice 사용
    // one_time 도 포함: stripe-webhook one_time 분기가 order_id 로 confirmed 처리 (감사 대칭)
    if ((isPack || isOneTime) && orderId) {
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
        amount: serverSidePrice,  // 서버측 가격 강제
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
