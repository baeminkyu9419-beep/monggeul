// 몽글몽글 — Google Play Developer API 구독 검증 (Gen113 iter#9 보안 하드닝)
// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
// [role-guard-bypass] Gen113 VULN_AUDIT A-4: userId 위조 차단 + 소유권 락 + productId 화이트리스트
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const GOOGLE_PACKAGE_NAME = Deno.env.get("GOOGLE_PACKAGE_NAME") || "com.monggeul.app";

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  monggeul_plus: "plus",
  monggeul_premium: "premium",
  monggeul_pro_monthly: "plus", // 레거시 별칭
};

const ALLOWED_ORIGINS = new Set<string>([
  "https://baeminkyu9419-beep.github.io",
  // "https://monggeul.app" — domain not registered/live; re-add when owned
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

// ── base64url 유틸 ──
function b64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── PEM PKCS8 → CryptoKey (RS256) ──
async function importGooglePrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// ── Google OAuth2 access token (service account JWT grant) ──
let _tokenCache: { token: string; exp: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  const keyJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!keyJson) throw new Error("google_service_account_missing");

  // 캐시 (만료 60초 전까지 재사용)
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache && _tokenCache.exp > now + 60) return _tokenCache.token;

  const key = JSON.parse(keyJson);
  const header = { alg: "RS256", typ: "JWT", kid: key.private_key_id };
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(
    JSON.stringify(claim),
  )}`;
  const privKey = await importGooglePrivateKey(key.private_key);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  const assertion = `${signingInput}.${b64urlEncode(sig)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  if (!tokenRes.ok) {
    throw new Error(`google_oauth_failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokenData = await tokenRes.json();
  _tokenCache = { token: tokenData.access_token, exp: now + (tokenData.expires_in || 3600) };
  return tokenData.access_token;
}

// purchaseToken hashing (eventId 에 raw token 노출 방지)
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const jsonHeaders = { "Content-Type": "application/json", ...cors };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders });
  }

  try {
    // 1. 사용자 JWT 검증
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userJwt || userJwt === SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: "unauthorized_no_user_jwt" }), { status: 401, headers: jsonHeaders });
    }
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: userData, error: userErr } = await anonClient.auth.getUser(userJwt);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "unauthorized_invalid_jwt" }), { status: 401, headers: jsonHeaders });
    }
    const verifiedUserId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { purchaseToken, subscriptionId } = body;
    if (!purchaseToken || !subscriptionId || typeof purchaseToken !== "string" || typeof subscriptionId !== "string") {
      return new Response(JSON.stringify({ error: "missing_params" }), { status: 400, headers: jsonHeaders });
    }
    // body.userId 무시. verifiedUserId 만 사용. [role-guard-bypass]

    // subscriptionId 화이트리스트 (공격자가 임의 productId 주입 차단)
    if (!Object.prototype.hasOwnProperty.call(PRODUCT_TO_ENTITLEMENT, subscriptionId)) {
      return new Response(
        JSON.stringify({ error: "unknown_subscription_id", subscriptionId }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 2. 멱등성 + 소유권 락 (purchaseToken hash 로 event_id 생성)
    const tokenHash = (await sha256Hex(purchaseToken)).substring(0, 40);
    const eventId = `google_verify_${tokenHash}`;
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id, payload")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing) {
      const ownerId = (existing.payload as any)?.__owner_user_id;
      if (ownerId && ownerId !== verifiedUserId) {
        console.warn(`[google-verify] token_replay_attempt tokenHash=${tokenHash} owner=${ownerId} attacker=${verifiedUserId}`);
        return new Response(
          JSON.stringify({ error: "purchase_token_already_bound_to_other_user" }),
          { status: 409, headers: jsonHeaders },
        );
      }
      const cached = (existing.payload as any)?.entitlement_key;
      if (cached) {
        return new Response(JSON.stringify({ entitlement: cached, cached: true }), { headers: jsonHeaders });
      }
    }

    // 3. Google OAuth2 토큰
    const accessToken = await getGoogleAccessToken();

    // 4. subscriptionsV2 상태 조회
    const googleRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${purchaseToken}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!googleRes.ok) {
      const errText = await googleRes.text();
      return new Response(
        JSON.stringify({ error: "google_verify_failed", status: googleRes.status, detail: errText }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const subscription = await googleRes.json();
    const lineItems = subscription.lineItems || [];
    const firstItem = lineItems[0] || {};
    // productId 는 서버 응답 기준. 클라 subscriptionId 는 화이트리스트 통과만 보증.
    const productId = firstItem.productId || subscriptionId;
    if (!Object.prototype.hasOwnProperty.call(PRODUCT_TO_ENTITLEMENT, productId)) {
      return new Response(
        JSON.stringify({ error: "unknown_product_id", productId }),
        { status: 400, headers: jsonHeaders },
      );
    }
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId];

    // productId 와 client subscriptionId 가 다르면 경고 로그 (swap 시도 추적)
    if (productId !== subscriptionId) {
      console.warn(`[google-verify] product_id_mismatch client=${subscriptionId} server=${productId} user=${verifiedUserId}`);
    }

    const stateMap: Record<string, string> = {
      SUBSCRIPTION_STATE_ACTIVE: "active",
      SUBSCRIPTION_STATE_CANCELED: "active",
      SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
      SUBSCRIPTION_STATE_ON_HOLD: "hold",
      SUBSCRIPTION_STATE_PAUSED: "hold",
      SUBSCRIPTION_STATE_EXPIRED: "expired",
    };
    const status = stateMap[subscription.subscriptionState] || "active";

    // 5. 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: verifiedUserId,
      platform: "google",
      platform_account_ref: purchaseToken.substring(0, 100),
      product_key: productId,
      transaction_ref: subscription.latestOrderId || eventId,
      event_type: "purchased",
      raw_payload: subscription,
      occurred_at: new Date().toISOString(),
    });

    // 6. 이벤트 기록 (entitlement_key + 소유권 스탬프)
    await supabase.from("billing_events").upsert(
      {
        event_id: eventId,
        platform: "google",
        event_type: "purchased",
        payload: { ...subscription, entitlement_key: entitlementKey, __owner_user_id: verifiedUserId },
        processed: true,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "event_id" },
    );

    // 7. entitlement 갱신 (verifiedUserId)
    const expiryTime = firstItem.expiryTime ? new Date(firstItem.expiryTime) : null;
    await supabase.from("user_entitlements").upsert({
      user_id: verifiedUserId,
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

    // 8. Acknowledge (필수! 3일 내 안 하면 자동 환불)
    await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE_NAME}/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}:acknowledge`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    return new Response(JSON.stringify({ entitlement: entitlementKey }), { headers: jsonHeaders });
  } catch (e) {
    console.error("billing-google-verify error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders });
  }
});
