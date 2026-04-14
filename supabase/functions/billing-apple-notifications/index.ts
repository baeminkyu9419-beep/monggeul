import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  "com.monggeul.plus.monthly": "plus",
  "com.monggeul.premium.monthly": "premium",
};

serve(async (req) => {
  try {
    const { signedPayload } = await req.json();
    if (!signedPayload) return new Response(null, { status: 400 });

    // JWT 디코딩 (Apple 공개키 검증은 프로덕션에서 필수)
    const payload = JSON.parse(atob(signedPayload.split(".")[1]));
    const { notificationType, subtype, data } = payload;
    const transactionInfo = data?.signedTransactionInfo
      ? JSON.parse(atob(data.signedTransactionInfo.split(".")[1]))
      : {};
    const renewalInfo = data?.signedRenewalInfo
      ? JSON.parse(atob(data.signedRenewalInfo.split(".")[1]))
      : {};

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 멱등성 체크
    const eventId = `apple_notif_${payload.notificationUUID || Date.now()}`;
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id")
      .eq("event_id", eventId)
      .single();
    if (existing) return new Response(null, { status: 200 });

    // 이벤트 기록
    await supabase.from("billing_events").insert({
      event_id: eventId,
      platform: "apple",
      event_type: notificationType,
      payload,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // 사용자 찾기 (originalTransactionId로)
    const originalTxId = transactionInfo.originalTransactionId;
    if (!originalTxId) return new Response(null, { status: 200 });

    const { data: txRecord } = await supabase
      .from("billing_transactions")
      .select("user_id")
      .eq("platform_account_ref", originalTxId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!txRecord) return new Response(null, { status: 200 });
    const userId = txRecord.user_id;
    const productId = transactionInfo.productId || "";
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId] || "plus";

    // 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: userId,
      platform: "apple",
      platform_account_ref: originalTxId,
      product_key: productId,
      transaction_ref: transactionInfo.transactionId || eventId,
      event_type: notificationType.toLowerCase(),
      raw_payload: payload,
      occurred_at: new Date().toISOString(),
    });

    // notificationType에 따른 entitlement 갱신
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), last_verified_at: new Date().toISOString() };

    switch (notificationType) {
      case "DID_RENEW":
        updates.entitlement_key = entitlementKey;
        updates.status = "active";
        updates.current_period_end = transactionInfo.expiresDate ? new Date(transactionInfo.expiresDate).toISOString() : null;
        updates.will_renew = true;
        break;
      case "DID_FAIL_TO_RENEW":
        updates.status = "grace";
        break;
      case "EXPIRED":
        updates.entitlement_key = "free";
        updates.status = "expired";
        break;
      case "REFUND":
        updates.entitlement_key = "free";
        updates.status = "refunded";
        break;
      case "REVOKE":
        updates.entitlement_key = "free";
        updates.status = "refunded";
        break;
      case "DID_CHANGE_RENEWAL_STATUS":
        updates.will_renew = renewalInfo.autoRenewStatus === 1;
        updates.auto_renew = renewalInfo.autoRenewStatus === 1;
        break;
      case "DID_CHANGE_RENEWAL_INFO":
        // 업/다운그레이드
        if (renewalInfo.autoRenewProductId) {
          updates.product_key = renewalInfo.autoRenewProductId;
          updates.entitlement_key = PRODUCT_TO_ENTITLEMENT[renewalInfo.autoRenewProductId] || entitlementKey;
        }
        break;
      default:
        break;
    }

    await supabase.from("user_entitlements").update(updates).eq("user_id", userId);

    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("Apple notification error:", e);
    return new Response(null, { status: 500 });
  }
});
