// Supabase Edge Function: 토스페이먼츠 Webhook 수신 (v2)
// MID: gbaemiomhk / 사업자: 제과다움
// 역할: 결제 상태 변경(취소/환불/빌링 갱신) 이벤트 수신 → DB 동기화
// 보안: HMAC-SHA256 서명 검증 (Toss-Signature 헤더)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOSS_WEBHOOK_SECRET = Deno.env.get('TOSS_WEBHOOK_SECRET')!

/**
 * HMAC-SHA256 서명 검증 — 토스 웹훅 위변조 방지.
 * 타이밍 공격을 막기 위해 상수 시간 비교를 사용한다.
 */
async function verifyTossSignature(body: string, signature: string | null): Promise<boolean> {
  if (!signature || !TOSS_WEBHOOK_SECRET) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TOSS_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expectedSignature = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  if (expectedSignature.length !== signature.length) return false
  let mismatch = 0
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.text()

    // HMAC-SHA256 서명 검증
    const signature = req.headers.get('Toss-Signature')
    const isValid = await verifyTossSignature(body, signature)
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const event = JSON.parse(body)
    const { eventType, data } = event

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    switch (eventType) {
      // ─── 결제 상태 변경 (취소/환불) ───────────────────────────────────
      case 'PAYMENT_STATUS_CHANGED': {
        if (!data?.orderId) break

        const { data: payment } = await supabase
          .from('payments')
          .select('*')
          .eq('order_id', data.orderId)
          .single()

        if (!payment) break

        const isCancelled = data.status === 'CANCELED'
        const isPartial = data.status === 'PARTIAL_CANCELED'

        if (isCancelled || isPartial) {
          await supabase.from('payments').update({
            status: isCancelled ? 'cancelled' : 'refunded',
            raw_response: data,
          }).eq('id', payment.id)

          // 연결된 권한 비활성화 (이미 confirmed 상태였을 경우에만)
          if (payment.status === 'confirmed') {
            await supabase.from('entitlements').update({
              is_active: false,
            }).eq('payment_id', payment.id)

            // pro 구독 취소 시 users 테이블 tier 초기화
            if (payment.product_id === 'pro_monthly') {
              await supabase.from('users').update({
                subscription_tier: 'free',
                subscription_expires_at: null,
              }).eq('id', payment.user_id)
            }
          }

          await supabase.from('events').insert({
            user_id: payment.user_id,
            event: 'payment_cancelled',
            properties: {
              pg: 'toss',
              order_id: data.orderId,
              reason: data.cancels?.[0]?.cancelReason ?? null,
              status: data.status,
            },
          })
        }
        break
      }

      // ─── 빌링키 정기결제 성공 (프로 구독 자동 갱신) ──────────────────
      case 'BILLING_PAYMENT_DONE': {
        if (!data?.orderId) break

        const userId: string | undefined = data.metadata?.user_id
        const productId: string | undefined = data.metadata?.product_id
        if (!userId || !productId) break

        const { data: product } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single()

        if (!product || product.type !== 'subscription') break

        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + (product.duration_days ?? 30))

        // 새 결제 레코드 삽입
        const { data: newPayment } = await supabase.from('payments').insert({
          user_id: userId,
          order_id: data.orderId,
          pg: 'toss',
          method: data.method ?? null,
          payment_key: data.paymentKey ?? null,
          product_id: productId,
          amount: data.totalAmount,
          status: 'confirmed',
          billing_key: data.billingKey ?? null,
          raw_response: data,
          confirmed_at: new Date().toISOString(),
        }).select('id').single()

        // 기존 구독 권한 갱신 (만료일 연장)
        await supabase.from('entitlements').update({
          expires_at: expiresAt.toISOString(),
          is_active: true,
        })
          .eq('user_id', userId)
          .eq('type', 'subscription')
          .eq('product_id', productId)

        // users 테이블 갱신
        await supabase.from('users').update({
          subscription_tier: 'pro',
          subscription_expires_at: expiresAt.toISOString(),
        }).eq('id', userId)

        await supabase.from('events').insert({
          user_id: userId,
          event: 'subscription_renewed',
          properties: {
            pg: 'toss',
            product_id: productId,
            order_id: data.orderId,
            amount: data.totalAmount,
            expires_at: expiresAt.toISOString(),
          },
        })
        break
      }

      // ─── 빌링키 발급 완료 ─────────────────────────────────────────────
      case 'BILLING_KEY_ISSUED': {
        // 필요 시 billingKey를 DB에 저장해 정기결제에 활용한다.
        const userId: string | undefined = data.metadata?.user_id
        if (!userId || !data.billingKey) break

        await supabase.from('billing_keys').upsert({
          user_id: userId,
          billing_key: data.billingKey,
          method: data.cardCompany ?? data.method ?? null,
          created_at: new Date().toISOString(),
        })
        break
      }

      default:
        // 알 수 없는 이벤트는 무시하고 200 반환 (토스 재전송 방지)
        break
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
