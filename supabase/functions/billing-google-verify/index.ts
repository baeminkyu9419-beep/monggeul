import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PACKAGE_NAME = "com.monggeul.app";

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  monggeul_plus: "plus",
  monggeul_premium: "premium",
};

serve(async (req) => {
  try {
    const { purchaseToken, subscriptionId, userId } = await req.json();
    if (!purchaseToken || !subscriptionId || !userId) {
      return new Response(JSON.stringify({ error: "missing params" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Google 서비스 계정 인증
    const accessToken = await getGoogleAccessToken();

    // 2. Google Play Developer API로 구독 상태 조회
    const googleRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${purchaseToken}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!googleRes.ok) {
      return new Response(JSON.stringify({ error: "google_verify_failed", status: googleRes.status }), { status: 400 });
    }

    const subscription = await googleRes.json();
    const lineItems = subscription.lineItems || [];
    const firstItem = lineItems[0] || {};
    const productId = firstItem.productId || subscriptionId;
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId] || "free";

    // 상태 매핑
    const stateMap: Record<string, string> = {
      SUBSCRIPTION_STATE_ACTIVE: "active",
      SUBSCRIPTION_STATE_CANCELED: "active", // 기간 끝까지 유효
      SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
      SUBSCRIPTION_STATE_ON_HOLD: "hold",
      SUBSCRIPTION_STATE_PAUSED: "hold",
      SUBSCRIPTION_STATE_EXPIRED: "expired",
    };
    const status = stateMap[subscription.subscriptionState] || "active";

    // 3. 멱등성
    const eventId = `google_verify_${purchaseToken.substring(0, 40)}`;
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id")
      .eq("event_id", eventId)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ entitlement: entitlementKey, cached: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: userId,
      platform: "google",
      platform_account_ref: purchaseToken.substring(0, 100),
      product_key: productId,
      transaction_ref: subscription.latestOrderId || eventId,
      event_type: "purchased",
      raw_payload: subscription,
      occurred_at: new Date().toISOString(),
    });

    await supabase.from("billing_events").insert({
      event_id: eventId,
      platform: "google",
      event_type: "purchased",
      payload: subscription,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // 5. entitlement 갱신
    const expiryTime = firstItem.expiryTime ? new Date(firstItem.expiryTime) : null;
    await supabase.from("user_entitlements").upsert({
      user_id: userId,
      entitlement_key: entitlementKey,
      source_platform: "android",
      product_key: productId,
      status,
      current_period_start: new Date().toISOString(),
      current_period_end: expiryTime?.toISOString() || null,
      will_renew: subscription.subscriptionState !== "SUBSCRIPTION_STATE_CANCELED",
      auto_renew: firstItem.autoRenewingPlan?.autoRenewEnabled ?? true,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 6. Acknowledge (필수! 안 하면 3일 후 자동 환불)
    await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}:acknowledge`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    return new Response(JSON.stringify({ entitlement: entitlementKey }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});

async function getGoogleAccessToken(): Promise<string> {
  // Google 서비스 계정 인증
  // GOOGLE_SERVICE_ACCOUNT_KEY 환경변수에 JSON 키 저장
  // 실제 구현 시 JWT → access_token 교환
  const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!keyJson) return "placeholder";

  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  // RS256 서명은 Deno의 crypto API로 수행
  // 간소화: 실제 배포 시 google-auth-library 사용 권장
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claim}.placeholder`,
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token || "placeholder";
}
