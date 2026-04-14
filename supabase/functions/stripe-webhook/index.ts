// Supabase Edge Function: Stripe Webhook (Plus/Premium 지원)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = sigHeader.split(',').reduce((acc: Record<string, string>, part) => {
      const [key, value] = part.split('=')
      acc[key] = value
      return acc
    }, {})
    const timestamp = parts['t']
    const signature = parts['v1']
    if (!timestamp || !signature) return false
    const signedPayload = `${timestamp}.${payload}`
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
    const expectedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return expectedSig === signature
  } catch { return false }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const body = await req.text()
    const sigHeader = req.headers.get('stripe-signature') || ''
    const valid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET)
    if (!valid) return new Response('Invalid signature', { status: 400 })

    const event = JSON.parse(body)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.client_reference_id || session.metadata?.user_id
        const tier = session.metadata?.tier || 'plus'
        const productId = session.metadata?.product_id || ''
        const orderId = session.metadata?.order_id || ''
        const isPack = productId.startsWith('pack_')
        // starlight 하위호환
        const entitlementKey = tier === 'starlight' ? 'plus' : tier

        if (userId) {
          if (isPack) {
            // ── 단건 팩 결제 ──
            // payments 테이블 업데이트
            if (orderId) {
              await supabase.from('payments').update({
                status: 'confirmed',
                payment_key: session.payment_intent,
                raw_response: session,
                confirmed_at: new Date().toISOString(),
              }).eq('order_id', orderId)
            }

            // products 테이블에서 횟수 조회
            const { data: product } = await supabase
              .from('products')
              .select('count')
              .eq('id', productId)
              .single()
            const packCount = product?.count || 1

            // 새 entitlements v2 테이블에 팩 권한 부여
            await supabase.from('entitlements').insert({
              user_id: userId,
              type: 'pack',
              product_id: productId,
              remaining: packCount,
              is_active: true,
            })

            // 기존 user_entitlements 하위호환 (크레딧 추가)
            const { data: existing } = await supabase
              .from('user_entitlements')
              .select('premium_credits')
              .eq('user_id', userId)
              .single()
            const currentCredits = existing?.premium_credits ?? 0
            await supabase.from('user_entitlements').upsert({
              user_id: userId,
              premium_credits: currentCredits + packCount,
              updated_at: new Date().toISOString(),
            })
          } else {
            // ── 구독 결제 ──
            const expiresAt = new Date()
            expiresAt.setMonth(expiresAt.getMonth() + 1)

            // 기존 users 테이블 (하위호환)
            await supabase.from('users').update({
              subscription_tier: entitlementKey,
              subscription_expires_at: expiresAt.toISOString(),
            }).eq('id', userId)

            // 기존 user_entitlements (하위호환)
            await supabase.from('user_entitlements').upsert({
              user_id: userId,
              entitlement_key: entitlementKey,
              source_platform: 'web',
              product_key: `monggeul_${entitlementKey}_monthly`,
              status: 'active',
              current_period_start: new Date().toISOString(),
              current_period_end: expiresAt.toISOString(),
              will_renew: true,
              auto_renew: true,
              last_verified_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })

            // 새 entitlements v2 테이블에 구독 권한 부여
            await supabase.from('entitlements').insert({
              user_id: userId,
              type: 'subscription',
              product_id: productId || 'starlight_monthly',
              expires_at: expiresAt.toISOString(),
              is_active: true,
            })
          }

          // 거래 로그
          await supabase.from('billing_transactions').insert({
            user_id: userId,
            platform: 'stripe',
            platform_account_ref: session.customer || '',
            product_key: isPack ? productId : `monggeul_${entitlementKey}_monthly`,
            transaction_ref: session.id,
            event_type: 'purchased',
            amount: (session.amount_total || 0) / 100,
            currency: session.currency || 'krw',
            raw_payload: session,
            occurred_at: new Date().toISOString(),
          })

          await supabase.from('events').insert({
            user_id: userId,
            event: 'checkout_completed',
            properties: {
              tier: entitlementKey,
              product_id: productId,
              is_pack: isPack,
              stripe_session_id: session.id,
            },
          })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const customerId = subscription.customer
        const customerRes = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
        })
        const customer = await customerRes.json()
        const userId = customer.metadata?.user_id
        if (userId) {
          await supabase.from('users').update({ subscription_tier: 'free', subscription_expires_at: null }).eq('id', userId)
          await supabase.from('user_entitlements').update({
            entitlement_key: 'free', status: 'expired', will_renew: false,
            updated_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
          }).eq('user_id', userId)
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        const customerId = invoice.customer
        const customerRes = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
        })
        const customer = await customerRes.json()
        const userId = customer.metadata?.user_id
        if (userId) {
          const expiresAt = new Date()
          expiresAt.setMonth(expiresAt.getMonth() + 1)
          await supabase.from('users').update({ subscription_expires_at: expiresAt.toISOString() }).eq('id', userId)
          await supabase.from('user_entitlements').update({
            status: 'active', current_period_end: expiresAt.toISOString(),
            updated_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
          }).eq('user_id', userId)
        }
        break
      }
    }

    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
