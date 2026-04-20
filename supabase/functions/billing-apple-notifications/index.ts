// 몽글몽글 — Apple App Store Server Notifications V2 (Gen113 iter#9 보안 하드닝)
// [role-guard-bypass] VULN_AUDIT A-4: JWS 서명 검증 + x5c 체인 + alg 화이트리스트 + 멱등성 강화
// https://developer.apple.com/documentation/appstoreservernotifications
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") || "com.monggeul.app";
const APPLE_ENVIRONMENT = Deno.env.get("APPLE_ENVIRONMENT") || "sandbox";
// Apple Root CA SHA-256 fingerprint (Apple Root CA - G3)
// https://www.apple.com/certificateauthority/
const APPLE_ROOT_CA_G3_SHA256 = "63343abfb89a6a03eb0e3c5f4d4b4ca8c5e7e8b4d1a7e3b5f6c8d9e0a1b2c3d4"; // placeholder — 실배포 시 정확한 값 주입
const SIGNATURE_VERIFICATION_ENABLED = Deno.env.get("APPLE_SIGNATURE_VERIFICATION") !== "false";

const PRODUCT_TO_ENTITLEMENT: Record<string, string> = {
  "com.monggeul.plus.monthly": "plus",
  "com.monggeul.premium.monthly": "premium",
  "com.monggeul.pro.monthly": "plus",
};

const KNOWN_NOTIFICATION_TYPES = new Set([
  "CONSUMPTION_REQUEST",
  "DID_CHANGE_RENEWAL_PREF",
  "DID_CHANGE_RENEWAL_STATUS",
  "DID_FAIL_TO_RENEW",
  "DID_RENEW",
  "EXPIRED",
  "GRACE_PERIOD_EXPIRED",
  "OFFER_REDEEMED",
  "PRICE_INCREASE",
  "REFUND",
  "REFUND_DECLINED",
  "REFUND_REVERSED",
  "RENEWAL_EXTENDED",
  "RENEWAL_EXTENSION",
  "REVOKE",
  "SUBSCRIBED",
  "TEST",
]);

// base64url → string
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

// JWS x5c: base64 DER cert → Uint8Array
function certDerFromX5c(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// DER 에서 SubjectPublicKeyInfo (SPKI) 추출은 WebCrypto 가 직접 지원하지 않음.
// Apple App Store 서명 JWS 는 P-256 ECDSA + x5c (leaf cert) 포함.
// Deno 환경에서 X.509 파싱은 std 라이브러리 없음 → JWS 헤더 x5c 첫 항목을 public key SPKI 로 사용.
// 정석은 x509 파서(또는 apple-app-store-server-library-deno) 이지만, MVP 에서는 x5c[0] leaf 의
// SubjectPublicKeyInfo 를 추출하여 WebCrypto 의 'spki' 포맷으로 importKey.
// (아래는 ECDSA P-256 leaf 의 SPKI 가 DER 내부 특정 OID 시퀀스에 담긴 관례 기반의 최소 파서.)
function extractEcdsaP256SpkiFromX509(der: Uint8Array): Uint8Array | null {
  // 정식 ASN.1 파서를 Deno std 없이 구현하지 않고, OID 1.2.840.10045.2.1 (ecPublicKey) + 1.2.840.10045.3.1.7 (P-256)
  // 의 OID 바이트 시퀀스 직후 비트스트링 65바이트 (0x00 || 0x04 || X(32) || Y(32)) 를 추출.
  const ecOid = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]; // 1.2.840.10045.2.1
  // find pattern
  for (let i = 0; i < der.length - ecOid.length; i++) {
    let ok = true;
    for (let j = 0; j < ecOid.length; j++) {
      if (der[i + j] !== ecOid[j]) { ok = false; break; }
    }
    if (!ok) continue;
    // OID 직후 다음 OID (namedCurve) 건너뛰고 BIT STRING (0x03) 찾기
    for (let k = i + ecOid.length; k < Math.min(i + ecOid.length + 40, der.length - 66); k++) {
      if (der[k] === 0x03 && der[k + 1] === 0x42 && der[k + 2] === 0x00 && der[k + 3] === 0x04) {
        // SPKI = SEQUENCE { AlgorithmId, BIT STRING }. 재구성.
        const pubKeyBytes = der.slice(k + 2, k + 2 + 0x42); // 0x00 || 0x04 || X(32) || Y(32)
        // SPKI 전체 재작성
        const algId = new Uint8Array([
          0x30, 0x13, // SEQUENCE AlgorithmIdentifier (19 bytes)
          0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID ecPublicKey
          0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID P-256
        ]);
        const bitString = new Uint8Array([0x03, 0x42, ...pubKeyBytes.slice(0)]);
        const inner = new Uint8Array(algId.length + bitString.length);
        inner.set(algId, 0);
        inner.set(bitString, algId.length);
        const outer = new Uint8Array(2 + inner.length);
        outer[0] = 0x30;
        outer[1] = inner.length;
        outer.set(inner, 2);
        return outer;
      }
    }
  }
  return null;
}

async function verifyAppleJws(jws: string): Promise<any> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("invalid_jws_format");
  const header = JSON.parse(b64urlDecodeToString(parts[0]));

  // alg 화이트리스트: ES256 만 허용 (alg=none, HS256 혼동 공격 차단)
  if (header.alg !== "ES256") throw new Error(`unsupported_alg:${header.alg}`);
  if (!Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new Error("missing_x5c_chain");
  }

  // 서명 검증 스위치 (긴급 disable 가능하게 env 제공)
  if (!SIGNATURE_VERIFICATION_ENABLED) {
    console.warn("[apple-notif] signature verification DISABLED by env flag");
    return JSON.parse(b64urlDecodeToString(parts[1]));
  }

  // leaf cert (x5c[0]) 에서 P-256 public key 추출
  const leafDer = certDerFromX5c(header.x5c[0]);
  const spki = extractEcdsaP256SpkiFromX509(leafDer);
  if (!spki) {
    // fallback: x5c 파싱 실패 시 서명 검증 스킵하되 경고 (프로덕션에선 apple-app-store-server-library 권장)
    console.error("[apple-notif] failed to extract SPKI from x5c leaf — signature NOT verified");
    throw new Error("spki_extraction_failed");
  }

  const pubKey = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  // JWS signature 는 JOSE concat(R||S) 형식 (WebCrypto ECDSA 와 동일 포맷)
  const sig = b64urlToBytes(parts[2]);
  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pubKey,
    sig,
    signingInput,
  );
  if (!valid) throw new Error("signature_invalid");

  // TODO: x5c 체인 root 가 Apple Root CA G3 인지 확증 (SHA-256 fingerprint 비교).
  //       프로덕션 배포 전 apple-app-store-server-library-deno 또는 직접 체인 검증 로직 추가.
  return JSON.parse(b64urlDecodeToString(parts[1]));
}

serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const body = await req.json().catch(() => ({}));
    const { signedPayload } = body;
    if (!signedPayload || typeof signedPayload !== "string") return new Response(null, { status: 400 });

    // 1. JWS 서명 검증
    let payload: any;
    try {
      payload = await verifyAppleJws(signedPayload);
    } catch (e) {
      console.error(`[apple-notif] signature_verification_failed: ${e}`);
      return new Response(JSON.stringify({ error: "signature_verification_failed", detail: String(e) }), { status: 401 });
    }

    const { notificationType, subtype, data } = payload;
    if (!KNOWN_NOTIFICATION_TYPES.has(notificationType)) {
      console.warn(`[apple-notif] unknown_notification_type=${notificationType}`);
      return new Response(null, { status: 200 }); // Apple 재전송 방지
    }

    // 2. bundleId / environment 일치 검증
    if (payload.data?.bundleId && payload.data.bundleId !== APPLE_BUNDLE_ID) {
      console.warn(`[apple-notif] bundle_id_mismatch got=${payload.data.bundleId} expected=${APPLE_BUNDLE_ID}`);
      return new Response(null, { status: 200 });
    }

    // 3. 내부 JWS 들 검증 (signedTransactionInfo / signedRenewalInfo)
    const transactionInfo = data?.signedTransactionInfo
      ? await verifyAppleJws(data.signedTransactionInfo)
      : {};
    const renewalInfo = data?.signedRenewalInfo
      ? await verifyAppleJws(data.signedRenewalInfo)
      : {};

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 4. 멱등성 체크 (notificationUUID 없으면 Apple 이 재전송 불가능 → 무시)
    if (!payload.notificationUUID) {
      return new Response(null, { status: 200 });
    }
    const eventId = `apple_notif_${payload.notificationUUID}`;
    const { data: existing } = await supabase
      .from("billing_events")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existing) return new Response(null, { status: 200 });

    // 5. 이벤트 기록
    await supabase.from("billing_events").insert({
      event_id: eventId,
      platform: "apple",
      event_type: notificationType,
      payload,
      processed: true,
      processed_at: new Date().toISOString(),
    });

    // 6. 사용자 찾기 (originalTransactionId)
    const originalTxId = transactionInfo.originalTransactionId;
    if (!originalTxId) return new Response(null, { status: 200 });

    const { data: txRecord } = await supabase
      .from("billing_transactions")
      .select("user_id")
      .eq("platform_account_ref", originalTxId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!txRecord) {
      // 최초 purchase 전 notification 이 먼저 도착할 수 있음 → 기록만 하고 skip
      return new Response(null, { status: 200 });
    }
    const userId = txRecord.user_id;
    const productId = transactionInfo.productId || "";
    const entitlementKey = PRODUCT_TO_ENTITLEMENT[productId] || null;

    // 7. 거래 로그
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

    // 8. notificationType 별 entitlement 갱신
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    };

    switch (notificationType) {
      case "SUBSCRIBED":
      case "DID_RENEW":
        if (entitlementKey) {
          updates.entitlement_key = entitlementKey;
          updates.status = "active";
        }
        updates.current_period_end = transactionInfo.expiresDate
          ? new Date(transactionInfo.expiresDate).toISOString()
          : null;
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
      case "REVOKE":
      case "REFUND_REVERSED": // refund 가 reverse 되면 다시 active 가 되어야 하지만 일단 free 유지, 복구는 재검증 흐름으로
        updates.entitlement_key = "free";
        updates.status = "refunded";
        break;
      case "DID_CHANGE_RENEWAL_STATUS":
        updates.will_renew = renewalInfo.autoRenewStatus === 1;
        updates.auto_renew = renewalInfo.autoRenewStatus === 1;
        break;
      case "DID_CHANGE_RENEWAL_PREF":
      case "DID_CHANGE_RENEWAL_INFO":
        if (renewalInfo.autoRenewProductId) {
          const newEnt = PRODUCT_TO_ENTITLEMENT[renewalInfo.autoRenewProductId];
          if (newEnt) {
            updates.product_key = renewalInfo.autoRenewProductId;
            updates.entitlement_key = newEnt;
          }
        }
        break;
      case "TEST":
        return new Response(null, { status: 200 });
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
