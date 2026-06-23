// Supabase Edge Function: 토스페이먼츠 Webhook
// 토스에서 결제 상태 변경 시 호출 (취소/환불/빌링 갱신 등)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { notifyOps } from "../_shared/notify-ops.ts"

const TOSS_SECRET_KEY = Deno.env.get('TOSS_SECRET_KEY')!
const TOSS_WEBHOOK_SECRET = Deno.env.get('TOSS_WEBHOOK_SECRET')!

/**
 * HMAC-SHA256 서명 검증 -- 토스 웹훅 위변조 방지
 * 토스가 보내는 Toss-Signature 헤더를 검증한다.
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

  // 타이밍 공격 방지를 위한 상수 시간 비교
  if (expectedSignature.length !== signature.length) return false
  let mismatch = 0
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // [관측 P1-2] catch 에서 주문 상관관계 로깅용 — orderId·메시지만 (시크릿·카드정보 금지)
  let opsOrderId = ''
  try {
    const body = await req.text()

    // HMAC-SHA256 서명 검증
    const signature = req.headers.get('Toss-Signature')
    const isValid = await verifyTossSignature(body, signature)
    if (!isValid) {
      // [운영자 알림 P0-1] 서명 거부 — 위조 시도 또는 TOSS_WEBHOOK_SECRET 불일치(설정 사고).
      // 미검증 body 내용은 알림에 싣지 않는다(공격자 통제 데이터).
      console.error('[toss-webhook] signature rejected', signature ? 'sig-present' : 'sig-missing')
      await notifyOps(`🚨 toss-webhook 서명 거부 (signature ${signature ? 'present' : 'missing'}) — 위조 시도 또는 TOSS_WEBHOOK_SECRET 불일치`)
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      })
    }

    const event = JSON.parse(body)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { eventType, data } = event
    opsOrderId = data?.orderId || ''

    switch (eventType) {
      // 결제 취소/환불
      case 'PAYMENT_STATUS_CHANGED': {
        if (!data?.orderId) break
        const { data: payment } = await supabase
          .from('payments')
          .select('*')
          .eq('order_id', data.orderId)
          .single()

        if (!payment) break

        if (data.status === 'CANCELED' || data.status === 'PARTIAL_CANCELED') {
          await supabase.from('payments').update({
            status: data.status === 'CANCELED' ? 'cancelled' : 'refunded',
            raw_response: data,
          }).eq('id', payment.id)

          // 관련 권한 비활성화
          if (payment.status === 'confirmed') {
            await supabase.from('entitlements').update({
              is_active: false,
            }).eq('payment_id', payment.id)

            // 구독 취소 시 users 테이블 tier 초기화 (pro/plus/premium 전 구독 플랜 포함)
            if (['pro_monthly', 'plus_monthly', 'premium_monthly'].includes(payment.product_id)) {
              await supabase.from('users').update({
                subscription_tier: 'free',
                subscription_expires_at: null,
              }).eq('id', payment.user_id)
            }
          }

          await supabase.from('events').insert({
            user_id: payment.user_id,
            event: 'payment_cancelled',
            props: { pg: 'toss', order_id: data.orderId, reason: data.cancels?.[0]?.cancelReason, status: data.status },
          })

          // [운영자 알림 P0-1] 취소/환불 — 매출 역전 이벤트는 즉시 인지 대상
          await notifyOps(`↩️ 토스 결제 ${data.status === 'CANCELED' ? '취소' : '부분취소(환불)'} — orderId=${data.orderId} reason=${data.cancels?.[0]?.cancelReason || ''}`)
        }
        break
      }

      // 빌링키 정기결제 성공 (향후 구독 갱신용)
      case 'BILLING_PAYMENT_DONE': {
        if (!data?.orderId) break
        const userId = data.metadata?.user_id
        if (!userId) break

        // [멱등성] 토스 재전송 시 payments insert 충돌(order_id unique)·events 중복 row·
        // 만료일 재연장(expiresAt 가 매 처리마다 now+duration 재계산) 방지 —
        // (orderId, paymentKey) 자연키를 billing_events 원장(stripe/apple/google 과 공용)에 선기록.
        // PK 원자 claim: 중복이면 23505 → 200 + duplicate (2xx = 토스 재전송 중단).
        const { error: dedupError } = await supabase.from('billing_events').insert({
          event_id: `toss_billing_${data.orderId}_${data.paymentKey || ''}`,
          platform: 'toss',
          event_type: eventType,
          payload: data,
          processed: true,
          processed_at: new Date().toISOString(),
        })
        if (dedupError) {
          if (dedupError.code === '23505') {
            return new Response(JSON.stringify({ received: true, duplicate: true }), {
              headers: { 'Content-Type': 'application/json' }
            })
          }
          // dedup 원장 기록 실패인데 진행하면 중복 가드 소실 → 500 으로 토스 재시도 유도 (fail-closed)
          throw new Error(`billing_events dedup insert failed: ${dedupError.message}`)
        }

        const { data: product } = await supabase
          .from('products')
          .select('*')
          .eq('id', data.metadata?.product_id)
          .single()

        if (product && product.type === 'subscription') {
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + (product.duration_days || 30))

          // 새 결제 레코드
          await supabase.from('payments').insert({
            user_id: userId,
            order_id: data.orderId,
            pg: 'toss',
            method: data.method,
            payment_key: data.paymentKey,
            product_id: product.id,
            amount: data.totalAmount,
            status: 'confirmed',
            billing_key: data.billingKey,
            raw_response: data,
            confirmed_at: new Date().toISOString(),
          })

          // 구독 갱신
          await supabase.from('entitlements').update({
            expires_at: expiresAt.toISOString(),
            is_active: true,
          })
          .eq('user_id', userId)
          .eq('type', 'subscription')
          .eq('product_id', product.id)

          // users 테이블 갱신 + 갱신 이벤트 (구 toss-payment-webhook v2 에서 통합)
          // product_id 기반으로 tier 동적 결정: premium_monthly → 'premium', 그 외 구독 → 'plus'
          const renewedTier = product.id === 'premium_monthly' ? 'premium' : 'plus'
          await supabase.from('users').update({
            subscription_tier: renewedTier,
            subscription_expires_at: expiresAt.toISOString(),
          }).eq('id', userId)

          await supabase.from('events').insert({
            user_id: userId,
            event: 'subscription_renewed',
            props: {
              pg: 'toss',
              product_id: product.id,
              order_id: data.orderId,
              amount: data.totalAmount,
              expires_at: expiresAt.toISOString(),
            },
          })
        }
        break
      }

      default:
        // 알 수 없는 이벤트는 무시하고 200 반환 (토스 재전송 방지)
        break
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    // [관측 P1-2] Supabase function logs 추적용 — orderId·메시지만
    console.error('[toss-webhook] error', opsOrderId, error?.message ?? error)
    // [운영자 알림 P0-1] 처리 예외 — 500 = 토스 재전송 예정, 반복되면 설정/스키마 사고
    await notifyOps(`🔥 toss-webhook 처리 예외(500→토스 재전송 예정) — orderId=${opsOrderId} err=${error?.message ?? error}`)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
