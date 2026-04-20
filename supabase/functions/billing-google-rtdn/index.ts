// 몽글몽글 — Google Play Real-Time Developer Notifications (Gen113 iter#9 보안 하드닝)
// [role-guard-bypass] VULN_AUDIT A-4: Pub/Sub OIDC JWT 검증 + 멱등성 키 고정 + productId 화이트리스트
// https://developer.android.com/google/play/billing/rtdn-reference
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Pub/Sub Push 서비스 계정 email (Cloud Console → Pub/Sub Subscription → OIDC authentication)
// 예: "rtdn-pubsub@<project>.iam.gserviceaccount.com"
const PUBSUB_SERVICE_ACCOUNT = Deno.env.get("PUBSUB_SERVICE_ACCOUNT") || "";
// Edge Function public URL (aud 검증용). 예: "https://<project>.supabase.co/functions/v1/billing-google-rtdn"
const RTDN_ENDPOINT_AUDIENCE = Deno.env.get("RTDN_ENDPOINT_AUDIENCE") || "";
const SIGNATURE_VERIFICATION_ENABLED = Deno.env.get("RTDN_SIGNATURE_VERIFICATION") !== "false";

// Google RTDN notificationType 매핑
const NOTIFICATION_TYPES: Record<number, string> = {
  1: "recovered", 2: "renewed", 3: "canceled", 4: "purchased",
  5: "on_hold", 6: "in_grace_period", 7: "restarted",
  12: "revoked", 13: "expired",
};

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  monggeul_plus: "plus",
  monggeul_premium: "premium",
  monggeul_pro_monthly: "plus",
};

// ── Google OAuth2 공개키 캐시 (RS256 OIDC JWT 검증) ──
let _jwksCache: { keys: any[]; exp: number } | null = null;
async function getGoogleJwks(): Promise<any[]> {
  const now = Math.floor(Date.now() / 1000);
  if (_jwksCache && _jwksCache.exp > now) return _jwksCache.keys;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error(`jwks_fetch_failed:${res.status}`);
  const data = await res.json();
  // 1시간 캐시
  _jwksCache = { keys: data.keys || [], exp: now + 3600 };
  return _jwksCache.keys;
}

function b64urlDecodeToString(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
function b64urlToBytes(s: string): Uint8Array {
  const bin = b64urlDecodeToString(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// JWK (RSA n, e) → CryptoKey (RS256)
async function importJwkRsa(jwk: any): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true, use: "sig" },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyPubSubOidcJwt(token: string): Promise<any> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_jwt_format");
  const header = JSON.parse(b64urlDecodeToString(parts[0]));
  const payload = JSON.parse(b64urlDecodeToString(parts[1]));

  // alg 화이트리스트: RS256 만
  if (header.alg !== "RS256") throw new Error(`unsupported_alg:${header.alg}`);

  // iss 검증
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error(`invalid_iss:${payload.iss}`);
  }

  // exp 검증
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    throw new Error("token_expired");
  }

  // aud 검증 (Edge Function public URL)
  if (RTDN_ENDPOINT_AUDIENCE && payload.aud !== RTDN_ENDPOINT_AUDIENCE) {
    throw new Error(`invalid_aud:${payload.aud}`);
  }

  // email 검증 (Pub/Sub Push service account)
  if (PUBSUB_SERVICE_ACCOUNT && payload.email !== PUBSUB_SERVICE_ACCOUNT) {
    throw new Error(`invalid_email:${payload.email}`);
  }

  // 서명 검증
  const jwks = await getGoogleJwks();
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`kid_not_found:${header.kid}`);
  const pubKey = await importJwkRsa(jwk);
  const sig = b64urlToBytes(parts[2]);
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    pubKey,
    sig,
    signingInput,
  );
  if (!valid) throw new Error("signature_invalid");

  return payload;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    // 1. Pub/Sub OIDC JWT 검증
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (SIGNATURE_VERIFICATION_ENABLED) {
      if (!token) {
        console.warn("[google-rtdn] missing_pubsub_authorization_header");
        return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401 });
      }
      try {
        await verifyPubSubOidcJwt(token);
      } catch (e) {
        console.error(`[google-rtdn] oidc_verification_failed: ${e}`);
        return new Response(JSON.stringify({ error: "oidc_verification_failed", detail: String(e) }), { status: 401 });
      }
    } else {
      console.warn("[google-rtdn] signature verification DISABLED by env flag");
    }

    // 2. Pub/Sub message 디코딩
    const body = await req.json().catch(() => ({}));
    const messageData = body.message?.data;
    const messageId = body.message?.messageId;
    if (!messageData) return new Response(null, { status: 200 });

    const data = JSON.parse(atob(messageData));
    const notification = data.subscriptionNotification;
    if (!notification) {
      // testNotification 등 — 200 반환해서 Pub/Sub ack
      return new Response(null, { status: 200 });
    }

    const { notificationType, purchaseToken, subscriptionId } = notification;
    if (!purchaseToken || typeof purchaseToken !== "string") {
      return new Response(null, { status: 200 });
    }
    const eventName = NOTIFICATION_TYPES[notificationType] || `unknown_${notificationType}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 3. 멱등성 키 (messageId 기반, Pub/Sub 가 동일 메시지 재전송 시 중복 처리 차단)
    // — 기존 코드는 Date.now() 를 포함해서 같은 message 가 여러 번 기록되는 버그 (H-RTDN-DEDUP)
    const eventId = `google_rtdn_${messageId || purchaseToken.substring(0, 30) + "_" + notificationType}`;
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existing) return new Response(null, { status: 200 });

    await supabase.from("billing_events").insert({
      event_id: eventId,
      platform: "google",
      event_type: eventName,
      payload: data,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // 4. purchaseToken 으로 사용자 찾기
    const { data: txRecord } = await supabase
      .from("billing_transactions")
      .select("user_id, product_key")
      .ilike("platform_account_ref", `${purchaseToken.substring(0, 50)}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!txRecord) return new Response(null, { status: 200 });

    const userId = txRecord.user_id;
    const effectiveProductId = subscriptionId || txRecord.product_key;
    // productId 화이트리스트 (알 수 없는 productId 로 entitlement 부여 방지)
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[effectiveProductId];
    if (!entitlementKey && [1, 2, 4, 7].includes(notificationType)) {
      // 활성화/복구 계열인데 productId 알 수 없음 → 차단
      console.warn(`[google-rtdn] unknown_product_id=${effectiveProductId} type=${notificationType}`);
      return new Response(null, { status: 200 });
    }

    // 5. 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: userId,
      platform: "google",
      platform_account_ref: purchaseToken.substring(0, 100),
      product_key: effectiveProductId,
      transaction_ref: eventId,
      event_type: eventName,
      raw_payload: data,
      occurred_at: new Date().toISOString(),
    });

    // 6. entitlement 갱신
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    };

    switch (notificationType) {
      case 1: // recovered
      case 2: // renewed
      case 4: // purchased
      case 7: // restarted
        if (entitlementKey) {
          updates.status = "active";
          updates.entitlement_key = entitlementKey;
          updates.product_key = effectiveProductId;
        }
        break;
      case 3: // canceled
        updates.will_renew = false;
        updates.auto_renew = false;
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
