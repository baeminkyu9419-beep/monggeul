// Supabase Edge Function: Push Subscribe
// 클라이언트 푸시 구독 정보를 DB에 저장

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // JWT에서 사용자 추출
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(token)

    const { subscription, prefs } = await req.json()
    if (!subscription?.endpoint) {
      return new Response(JSON.stringify({ error: 'subscription required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // push_subscriptions 테이블에 upsert (알림 선호 포함)
    const record: Record<string, unknown> = {
      user_id: user?.id || null,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      created_at: new Date().toISOString(),
    }
    if (prefs) record.prefs = prefs

    const { error } = await supabase.from('push_subscriptions').upsert(
      record,
      { onConflict: 'endpoint' }
    )

    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
