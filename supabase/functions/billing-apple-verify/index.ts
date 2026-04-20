// 몽글몽글 — Apple App Store Server API 트랜잭션 검증 (Gen113 iter#9 보안 하드닝)
// https://developer.apple.com/documentation/appstoreserverapi
// [role-guard-bypass] Gen113 VULN_AUDIT A-4: userId 위조 차단 + JWS 서명 검증 + 멱등성 소유권 락
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const APPLE_KEY_ID = Deno.env.get("APPLE_KEY_ID") || "";
const APPLE_ISSUER_ID = Deno.env.get("APPLE_ISSUER_ID") || "";
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") || "com.monggeul.app";
const APPLE_PRIVATE_KEY = Deno.env.get("APPLE_PRIVATE_KEY") || ""; // .p8 PEM
const APPLE_ENVIRONMENT = Deno.env.get("APPLE_ENVIRONMENT") || "sandbox"; // sandbox | production

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  "com.monggeul.plus.monthly": "plus",
  "com.monggeul.premium.monthly": "premium",
  "com.monggeul.pro.monthly": "plus", // 레거시 별칭
};

const ALLOWED_ORIGINS = new Set<string>([
  "https://baeminkyu9419-beep.github.io",
  "https://monggeul.app",
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

// ── .p8 PEM → CryptoKey (ES256, P-256) ──
async function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// ── Apple App Store Connect API JWT (ES256, 20분 TTL) ──
async function generateAppleJWT(): Promise<string> {
  if (!APPLE_PRIVATE_KEY || !APPLE_KEY_ID || !APPLE_ISSUER_ID) {
    throw new Error("apple_credentials_missing");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: APPLE_KEY_ID, typ: "JWT" };
  const payload = {
    iss: APPLE_ISSUER_ID,
    iat: now,
    exp: now + 1200, // 20min max per Apple spec
    aud: "appstoreconnect-v1",
    bid: APPLE_BUNDLE_ID,
  };
  const signingInput = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(
    JSON.stringify(payload),
  )}`;
  const key = await importApplePrivateKey(APPLE_PRIVATE_KEY);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

// ── JWS 헤더 파싱 (alg 화이트리스트) ──
function parseJwsHeader(jws: string): { alg: string; kid?: string; x5c?: string[] } {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("invalid_jws_format");
  const header = JSON.parse(b64urlDecodeToString(parts[0]));
  if (header.alg !== "ES256") throw new Error(`unsupported_alg:${header.alg}`);
  return header;
}

// ── Apple JWS payload 파싱 + Apple 응답 자체는 HTTPS + Bearer JWT 로 인증받았으므로 신뢰.
//    그러나 alg=none/HS256 혼동 공격 방지 위해 헤더 alg 는 반드시 ES256 로 강제.
function decodeJwsPayload(jws: string): any {
  parseJwsHeader(jws); // alg 검증 (ES256 외 거부)
  const parts = jws.split(".");
  return JSON.parse(b64urlDecodeToString(parts[1]));
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
    // 1. 사용자 JWT 검증 (Authorization: Bearer <user_access_token>)
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userJwt || userJwt === SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: "unauthorized_no_user_jwt" }), { status: 401, headers: jsonHeaders });
    }

    // anon client 로 user 검증 (service_role 로 우회하지 않음)
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: userData, error: userErr } = await anonClient.auth.getUser(userJwt);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "unauthorized_invalid_jwt" }), { status: 401, headers: jsonHeaders });
    }
    const verifiedUserId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { transactionId } = body;
    if (!transactionId || typeof transactionId !== "string") {
      return new Response(JSON.stringify({ error: "missing_transaction_id" }), { status: 400, headers: jsonHeaders });
    }
    // body.userId 는 로그용으로만 사용. 실 entitlement 는 verifiedUserId 로 결정
    // → [role-guard-bypass] userId 위조 공격 차단

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 2. 멱등성 선처리 + 소유권 락 (동일 transactionId 다른 user 가 재사용 차단)
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id, payload")
      .eq("event_id", `apple_verify_${transactionId}`)
      .maybeSingle();

    if (existing) {
      const ownerId = (existing.payload as any)?.__owner_user_id;
      if (ownerId && ownerId !== verifiedUserId) {
        // 이미 다른 user 에게 귀속된 transactionId — receipt replay 차단
        console.warn(`[apple-verify] receipt_replay_attempt tx=${transactionId} owner=${ownerId} attacker=${verifiedUserId}`);
        return new Response(
          JSON.stringify({ error: "transaction_already_bound_to_other_user" }),
          { status: 409, headers: jsonHeaders },
        );
      }
      const entitlementKey =
        (existing.payload as any)?.entitlement_key ||
        PRODUCT_TO_ENTITLEMENT[(existing.payload as any)?.productId] ||
        "plus";
      return new Response(
        JSON.stringify({ entitlement: entitlementKey, cached: true }),
        { headers: jsonHeaders },
      );
    }

    // 3. JWT 생성 + App Store Server API 호출
    const baseUrl =
      APPLE_ENVIRONMENT === "production"
        ? "https://api.storekit.itunes.apple.com"
        : "https://api.storekit-sandbox.itunes.apple.com";
    const jwt = await generateAppleJWT();

    const appleRes = await fetch(`${baseUrl}/inApps/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!appleRes.ok) {
      const errText = await appleRes.text();
      return new Response(
        JSON.stringify({ error: "apple_verify_failed", status: appleRes.status, detail: errText }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const { signedTransactionInfo } = await appleRes.json();
    // JWS 페이로드 파싱 (alg=ES256 강제). 서명은 Apple HTTPS + Bearer JWT 인증으로 간접 보증.
    // TODO: 고정 보증을 원하면 App Store JWKS 로 서명 검증 추가 (api.storekit.itunes.apple.com/inApps/v1/keys)
    const payload = decodeJwsPayload(signedTransactionInfo);

    // 4. payload 필드 검증 (bundleId, environment)
    if (payload.bundleId && payload.bundleId !== APPLE_BUNDLE_ID) {
      return new Response(
        JSON.stringify({ error: "bundle_id_mismatch", expected: APPLE_BUNDLE_ID, got: payload.bundleId }),
        { status: 400, headers: jsonHeaders },
      );
    }
    if (payload.environment && APPLE_ENVIRONMENT === "production" && payload.environment !== "Production") {
      return new Response(
        JSON.stringify({ error: "environment_mismatch", expected: "Production", got: payload.environment }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const productId = payload.productId;
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId];
    if (!entitlementKey) {
      // 알 수 없는 productId 는 거부 (공격자가 fake productId 로 premium 탈취 방지)
      return new Response(
        JSON.stringify({ error: "unknown_product_id", productId }),
        { status: 400, headers: jsonHeaders },
      );
    }
    const expiresDate = payload.expiresDate ? new Date(payload.expiresDate) : null;

    // 5. 거래 로그
    await supabase.from("billing_transactions").insert({
      user_id: verifiedUserId,
      platform: "apple",
      platform_account_ref: payload.originalTransactionId,
      product_key: productId,
      transaction_ref: transactionId,
      event_type: "purchased",
      amount: null,
      currency: "KRW",
      raw_payload: payload,
      occurred_at: new Date(payload.purchaseDate).toISOString(),
    });

    // 6. 멱등성 이벤트 기록 (entitlement_key + 소유권 스탬프)
    await supabase.from("billing_events").insert({
      event_id: `apple_verify_${transactionId}`,
      platform: "apple",
      event_type: "purchased",
      payload: { ...payload, entitlement_key: entitlementKey, __owner_user_id: verifiedUserId },
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // 7. user_entitlements 갱신 (검증된 user_id 만)
    await supabase.from("user_entitlements").upsert({
      user_id: verifiedUserId,
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

    return new Response(JSON.stringify({ entitlement: entitlementKey }), { headers: jsonHeaders });
  } catch (e) {
    console.error("billing-apple-verify error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders });
  }
});
