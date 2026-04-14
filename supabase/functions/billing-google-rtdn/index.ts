import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Google RTDN notificationType 매핑
// https://developer.android.com/google/play/billing/rtdn-reference
const NOTIFICATION_TYPES: Record<number, string> = {
  1: "recovered",          // 결제 복구
  2: "renewed",            // 갱신 성공
  3: "canceled",           // 자동갱신 해제
  4: "purchased",          // 최초 구매
  5: "on_hold",            // 보류
  6: "in_grace_period",    // 유예기간
  7: "restarted",          // 재구독
  12: "revoked",           // 취소/환불
  13: "expired",           // 만료
};

serve(async (req) => {
  try {
    const body = await req.json();
    const messageData = body.message?.data;
    if (!messageData) return new Response(null, { status: 200 });

    const data = JSON.parse(atob(messageData));
    const notification = data.subscriptionNotification;
    if (!notification) return new Response(null, { status: 200 });

    const { notificationType, purchaseToken, subscriptionId } = notification;
    const eventName = NOTIFICATION_TYPES[notificationType] || `unknown_${notificationType}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 멱등성
    const eventId = `google_rtdn_${purchaseToken?.substring(0, 30)}_${notificationType}_${Date.now()}`;
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id")
      .eq("event_id", eventId)
      .single();
    if (existing) return new Response(null, { status: 200 });

    await supabase.from("billing_events").insert({
      event_id: eventId,
      platform: "google",
      event_type: eventName,
      payload: data,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // purchaseToken으로 사용자 찾기
    const { data: txRecord } = await supabase
      .from("billing_transactions")
      .select("user_id, product_key")
      .ilike("platform_account_ref", `${purchaseToken?.substring(0, 50)}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!txRecord) return new Response(null, { status: 200 });

    const userId = txRecord.user_id;

    // 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: userId,
      platform: "google",
      platform_account_ref: purchaseToken?.substring(0, 100) || "",
      product_key: subscriptionId || txRecord.product_key,
      transaction_ref: eventId,
      event_type: eventName,
      raw_payload: data,
      occurred_at: new Date().toISOString(),
    });

    // entitlement 갱신
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    };

    switch (notificationType) {
      case 1: // recovered
      case 2: // renewed
      case 4: // purchased
      case 7: // restarted
        updates.status = "active";
        break;
      case 3: // canceled
        updates.will_renew = false;
        updates.auto_renew = false;
        // 기간 끝까지는 active 유지
        break;
      case 5: // on_hold
      case 6: // in_grace_period
        updates.status = "grace";
        break;
      case 12: // revoked
        updates.entitlement_key = "free";
        updates.status = "refunded";
        break;
      case 13: // expired
        updates.entitlement_key = "free";
        updates.status = "expired";
        break;
    }

    await supabase.from("user_entitlements").update(updates).eq("user_id", userId);

    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("Google RTDN error:", e);
    return new Response(null, { status: 500 });
  }
});
