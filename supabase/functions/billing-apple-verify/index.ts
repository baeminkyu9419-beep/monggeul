import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLE_KEY_ID = Deno.env.get("APPLE_KEY_ID") || "";
const APPLE_ISSUER_ID = Deno.env.get("APPLE_ISSUER_ID") || "";
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") || "com.monggeul.app";

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  "com.monggeul.plus.monthly": "plus",
  "com.monggeul.premium.monthly": "premium",
};

serve(async (req) => {
  try {
    const { transactionId, userId } = await req.json();
    if (!transactionId || !userId) {
      return new Response(JSON.stringify({ error: "missing params" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Apple App Store Server API로 트랜잭션 검증
    //    GET https://api.storekit.itunes.apple.com/inApps/v1/transactions/{transactionId}
    //    JWT 서명 필요 (App Store Connect API Key)
    //    Sandbox: https://api.storekit-sandbox.itunes.apple.com/...
    const environment = Deno.env.get("APPLE_ENVIRONMENT") || "sandbox";
    const baseUrl = environment === "production"
      ? "https://api.storekit.itunes.apple.com"
      : "https://api.storekit-sandbox.itunes.apple.com";

    // JWT 생성 (ES256, App Store Connect Key)
    // 실제 배포 시 APPLE_PRIVATE_KEY 환경변수에서 .p8 키 로드
    const jwt = await generateAppleJWT();

    const appleRes = await fetch(`${baseUrl}/inApps/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!appleRes.ok) {
      return new Response(JSON.stringify({ error: "apple_verify_failed", status: appleRes.status }), { status: 400 });
    }

    const { signedTransactionInfo } = await appleRes.json();
    // JWT 디코딩 (페이로드만)
    const payload = JSON.parse(atob(signedTransactionInfo.split(".")[1]));

    const productId = payload.productId;
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId] || "free";
    const expiresDate = payload.expiresDate ? new Date(payload.expiresDate) : null;

    // 2. 멱등성 체크
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id")
      .eq("event_id", `apple_verify_${transactionId}`)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ entitlement: entitlementKey, cached: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: userId,
      platform: "apple",
      platform_account_ref: payload.originalTransactionId,
      product_key: productId,
      transaction_ref: transactionId,
      event_type: "purchased",
      amount: null, // Apple은 금액을 직접 제공하지 않음
      currency: "KRW",
      raw_payload: payload,
      occurred_at: new Date(payload.purchaseDate).toISOString(),
    });

    // 4. 멱등성 이벤트 기록
    await supabase.from("billing_events").insert({
      event_id: `apple_verify_${transactionId}`,
      platform: "apple",
      event_type: "purchased",
      payload,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // 5. user_entitlements 갱신
    await supabase.from("user_entitlements").upsert({
      user_id: userId,
      entitlement_key: entitlementKey,
      source_platform: "ios",
      product_key: productId,
      status: "active",
      current_period_start: new Date(payload.purchaseDate).toISOString(),
      current_period_end: expiresDate?.toISOString() || null,
      will_renew: true,
      auto_renew: true,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ entitlement: entitlementKey }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});

async function generateAppleJWT(): Promise<string> {
  // 실제 구현 시 APPLE_PRIVATE_KEY (.p8) + APPLE_KEY_ID + APPLE_ISSUER_ID로
  // ES256 JWT를 생성해야 함
  // 참고: https://developer.apple.com/documentation/appstoreserverapi/generating_tokens_for_api_requests
  return Deno.env.get("APPLE_JWT_TOKEN") || "placeholder";
}
