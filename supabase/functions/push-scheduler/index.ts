// Supabase Edge Function: Push Scheduler
// Cron 호출로 알림 유형별 푸시 발송
// 배포 후 Supabase Dashboard > Cron 에서 스케줄 등록:
//   아침 알림: 0 23 * * * (UTC = KST 08:00)
//   패턴 알림: 0 22 * * * (UTC = KST 07:00) — 아침 알림보다 1시간 먼저
//   주간 알림: 0 0 * * 0  (UTC = KST 일요일 09:00)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:monggeul@example.com'
// [보안 P1] Cron 공유 시크릿. Supabase Cron 등록 시 Authorization: Bearer <CRON_SECRET> 주입.
// 미설정 시 fail-closed(401) — 무인증 브로드캐스트 차단.
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

// 상수시간 문자열 비교 (타이밍 공격 차단)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Web Push 암호화 (web-push 라이브러리 대신 Web Crypto API 사용)
async function sendWebPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) {
  // VAPID JWT 생성
  const audience = new URL(subscription.endpoint).origin
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const claims = { aud: audience, exp: now + 3600, sub: VAPID_SUBJECT }

  const jwtHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwtClaims = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  // ES256 서명을 위한 키 가져오기
  const keyData = base64UrlToUint8Array(VAPID_PRIVATE_KEY)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  ).catch(() => null)

  if (!cryptoKey) {
    console.error('VAPID key import failed')
    return false
  }

  const signInput = new TextEncoder().encode(`${jwtHeader}.${jwtClaims}`)
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, signInput)
  const jwtSig = arrayBufferToBase64Url(signature)
  const jwt = `${jwtHeader}.${jwtClaims}.${jwtSig}`

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payload,
  })

  return res.ok || res.status === 201
}

function base64UrlToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - b64.length % 4) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// 알림 유형별 메시지
const MESSAGES: Record<string, { title: string; body: string; url: string }> = {
  morning: {
    title: '🌙 몽글몽글',
    body: '어젯밤 꿈을 기록해 보세요!',
    url: '/monggeul/?tab=dream',
  },
  pattern: {
    title: '🔄 반복꿈 알림',
    body: '반복꿈 주기가 다가왔어요. 패턴을 확인해보세요',
    url: '/monggeul/?tab=log',
  },
  dali_weekly: {
    title: '🐱 달이의 주간 정리',
    body: '달이가 이번 주 꿈을 정리해뒀어요. 확인해보세요!',
    url: '/monggeul/?tab=chat',
  },
}

// 전체 구독자에게 발송 (morning, dali_weekly)
async function sendBroadcast(
  supabase: ReturnType<typeof createClient>,
  type: string,
) {
  const msg = MESSAGES[type] || MESSAGES.morning
  const payload = JSON.stringify({ ...msg, type })

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys, prefs')
    .limit(1000)

  if (error) throw error

  let sent = 0
  let failed = 0
  const staleEndpoints: string[] = []

  for (const sub of subs || []) {
    // 알림 선호 확인
    const prefs = sub.prefs || {}
    if (prefs[type] === false) continue

    try {
      const ok = await sendWebPush(sub, payload)
      if (ok) { sent++ } else {
        failed++
        staleEndpoints.push(sub.endpoint)
      }
    } catch {
      failed++
      staleEndpoints.push(sub.endpoint)
    }
  }

  // 실패한 구독 정리 (410 Gone 등)
  if (staleEndpoints.length > 0) {
    await supabase.from('push_subscriptions')
      .delete()
      .in('endpoint', staleEndpoints)
      .then(() => {})
  }

  return { sent, failed, total: subs?.length || 0 }
}

// 패턴 알림: 반복꿈 예측일이 오늘/내일인 사용자에게만 발송
async function sendPatternAlerts(supabase: ReturnType<typeof createClient>) {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  // 예측일이 오늘 또는 내일인 사용자 조회
  const { data: patterns, error: patErr } = await supabase
    .from('dream_pattern_cache')
    .select('user_id, clusters')
    .or(`next_pattern_date.eq.${today},next_pattern_date.eq.${tomorrow}`)

  if (patErr || !patterns?.length) {
    return { sent: 0, failed: 0, total: 0, reason: patErr ? 'query_error' : 'no_patterns' }
  }

  const userIds = patterns.map(p => p.user_id)

  // 해당 사용자들의 구독 정보 조회
  const { data: subs, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys, prefs, user_id')
    .in('user_id', userIds)

  if (subErr || !subs?.length) {
    return { sent: 0, failed: 0, total: 0, reason: 'no_subs' }
  }

  let sent = 0
  let failed = 0
  const staleEndpoints: string[] = []

  for (const sub of subs) {
    if (sub.prefs?.pattern === false) continue

    // 해당 사용자의 가장 임박한 클러스터 키워드 찾기
    const userPattern = patterns.find(p => p.user_id === sub.user_id)
    const topCluster = (userPattern?.clusters || [])[0]
    const keyword = topCluster?.keyword || '반복꿈'

    const payload = JSON.stringify({
      ...MESSAGES.pattern,
      body: `'${keyword}' 반복꿈 주기가 다가왔어요. 패턴을 확인해보세요`,
      type: 'pattern',
    })

    try {
      const ok = await sendWebPush(sub, payload)
      if (ok) { sent++ } else {
        failed++
        staleEndpoints.push(sub.endpoint)
      }
    } catch {
      failed++
      staleEndpoints.push(sub.endpoint)
    }
  }

  if (staleEndpoints.length > 0) {
    await supabase.from('push_subscriptions')
      .delete()
      .in('endpoint', staleEndpoints)
      .then(() => {})
  }

  return { sent, failed, total: subs.length }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // [보안 P1] Cron 공유 시크릿 게이트 — 누구나 전체 구독자 푸시 브로드캐스트 트리거 차단.
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!CRON_SECRET || !timingSafeEqual(token, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { type } = await req.json().catch(() => ({ type: 'morning' }))

    let result
    if (type === 'pattern') {
      result = await sendPatternAlerts(supabase)
    } else {
      result = await sendBroadcast(supabase, type)
    }

    // 발송 로그
    await supabase.from('events').insert({
      event: 'push_batch_sent',
      properties: { type, ...result },
    }).then(() => {})

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
