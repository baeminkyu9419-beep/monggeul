// 몽글몽글 — Apple App Store Server Notifications V2 (Gen113 iter#9 보안 하드닝)
// [role-guard-bypass] VULN_AUDIT A-4: JWS 서명 검증 + x5c 체인 + alg 화이트리스트 + 멱등성 강화
// https://developer.apple.com/documentation/appstoreservernotifications
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { X509Certificate } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID") || "com.monggeul.app";
const APPLE_ENVIRONMENT = Deno.env.get("APPLE_ENVIRONMENT") || "sandbox";
// Apple Root CA SHA-256 fingerprint (Apple Root CA - G3), colon-less lowercase hex.
// 출처: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer 의 fingerprint256 실측값.
// (subject==issuer=="Apple Root CA - G3", self-signed, ca:true)
const APPLE_ROOT_CA_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
// 운영자가 정본 외 추가 신뢰 root 를 주입할 수 있게 허용(콤마 구분, colon-less lowercase hex).
const EXTRA_TRUSTED_ROOTS = (Deno.env.get("APPLE_EXTRA_ROOT_FINGERPRINTS") || "")
  .split(",")
  .map((s) => s.replace(/:/g, "").trim().toLowerCase())
  .filter(Boolean);
const TRUSTED_ROOT_FINGERPRINTS = new Set<string>([
  APPLE_ROOT_CA_G3_SHA256,
  ...EXTRA_TRUSTED_ROOTS,
]);
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

// JWS x5c: base64 (표준 base64, base64url 아님) DER cert → X509Certificate
function x509FromX5c(b64: string): X509Certificate {
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return new X509Certificate(der);
}

function fp256(cert: X509Certificate): string {
  // node:crypto fingerprint256 = "AA:BB:.." → colon-less lowercase hex 로 정규화.
  return cert.fingerprint256.replace(/:/g, "").toLowerCase();
}

// x5c 체인을 Apple Root CA 까지 검증한다.
//   1) 인접 인증서가 실제로 issuer 관계인지(checkIssued) + 상위 공개키로 서명 검증(verify).
//   2) 체인 최상위(또는 체인에 포함된 신뢰 root) 의 SHA-256 fingerprint 가 신뢰 set 에 있는지.
// 통과 시 leaf 인증서를 반환(JWS payload 서명 검증에 사용).
//
// [P1 수정] 이전 구현은 leaf(x5c[0]) 공개키로 JWS 서명만 확인하고 root 를 확증하지 않아,
//   공격자가 자체서명 인증서를 x5c 에 넣어 위조 알림(SUBSCRIBED→승급, REFUND→강등)을
//   통과시킬 수 있었다. 이제 체인이 Apple Root CA G3 에 anchor 되지 않으면 거부한다.
export function verifyX5cChain(x5c: string[]): X509Certificate {
  if (!Array.isArray(x5c) || x5c.length === 0) throw new Error("missing_x5c_chain");
  const certs = x5c.map(x509FromX5c);

  // 만료/미발효 검사 (validFrom/validTo 는 RFC1123 형식)
  const now = Date.now();
  for (const c of certs) {
    if (Number.isFinite(Date.parse(c.validFrom)) && Date.parse(c.validFrom) > now) {
      throw new Error("cert_not_yet_valid");
    }
    if (Number.isFinite(Date.parse(c.validTo)) && Date.parse(c.validTo) < now) {
      throw new Error("cert_expired");
    }
  }

  // 인접 issuer 관계 + 서명 검증
  for (let i = 0; i < certs.length - 1; i++) {
    const child = certs[i];
    const parent = certs[i + 1];
    if (!child.checkIssued(parent)) throw new Error(`chain_broken_at:${i}`);
    if (!child.verify(parent.publicKey)) throw new Error(`chain_sig_invalid_at:${i}`);
  }

  // 신뢰 root anchor: 체인 안의 어떤 인증서든 fingerprint 가 신뢰 set 에 있으면,
  // 그 지점까지의 서명 체인은 위에서 검증됐으므로 leaf 가 Apple 로부터 유래함이 보장된다.
  // (Apple 은 보통 leaf, intermediate(WWDR/G6), root(G3) 3장을 보냄. root 가 x5c 에 포함될 수도,
  //  intermediate 까지만 올 수도 있어 두 경우 모두 처리한다.)
  let anchored = false;
  for (let i = 0; i < certs.length; i++) {
    if (TRUSTED_ROOT_FINGERPRINTS.has(fp256(certs[i]))) { anchored = true; break; }
    // 체인 끝 인증서가 root(G3) 의 자식이면(= root 가 x5c 에 없어도) anchor 인정.
    // 단 이 경우 root 인증서 자체가 없으므로 fingerprint 비교만으로 anchor 를 인정하지 않고,
    // 마지막 인증서의 issuer 정보가 Apple Root CA G3 와 일치하는지로 한정한다.
  }
  if (!anchored) {
    // 체인에 신뢰 root 가 직접 포함되지 않은 경우: 최상위 인증서의 issuer 가
    // "Apple Root CA - G3" 인지로 보수적으로 거부/허용을 결정한다.
    // Apple Root 가 누락된 채로 위조 self-signed 체인이 통과되지 않도록, issuer DN 만으로는
    // 신뢰하지 않고 명시적으로 거부한다(운영자는 APPLE_EXTRA_ROOT_FINGERPRINTS 로 주입 가능).
    throw new Error("untrusted_root_chain");
  }
  return certs[0];
}

async function importLeafPublicKey(leaf: X509Certificate): Promise<CryptoKey> {
  // X509Certificate.publicKey → DER SPKI 추출 후 WebCrypto ECDSA P-256 importKey.
  const spkiDer = leaf.publicKey.export({ type: "spki", format: "der" }) as unknown as Uint8Array;
  return await crypto.subtle.importKey(
    "spki",
    spkiDer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function verifyAppleJws(jws: string): Promise<any> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("invalid_jws_format");
  const header = JSON.parse(b64urlDecodeToString(parts[0]));

  // alg 화이트리스트: ES256 만 허용 (alg=none, HS256 혼동 공격 차단)
  if (header.alg !== "ES256") throw new Error(`unsupported_alg:${header.alg}`);
  if (!Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new Error("missing_x5c_chain");
  }

  // [보안 P1: fail-closed] 서명 검증 스위치는 sandbox 에서만, 그리고 명시적 dev 탈출 플래그가
  // 있을 때만 허용. 프로덕션(APPLE_ENVIRONMENT=Production)에서는 비활성 플래그를 무시하고
  // 항상 검증한다 → env 하나로 미검증 위조 알림(REFUND→강등, SUBSCRIBED→승급)을 신뢰하는 구멍 차단.
  if (!SIGNATURE_VERIFICATION_ENABLED) {
    const isProd = APPLE_ENVIRONMENT === "Production";
    const allowUnverified = Deno.env.get("APPLE_ALLOW_UNVERIFIED") === "true";
    if (isProd || !allowUnverified) {
      throw new Error("signature_verification_disabled_refused");
    }
    console.warn("[apple-notif] signature verification DISABLED (sandbox dev escape)");
    return JSON.parse(b64urlDecodeToString(parts[1]));
  }

  // [P1 수정] x5c 체인을 Apple Root CA G3 까지 검증 → anchor 확보된 leaf 만 신뢰.
  const leaf = verifyX5cChain(header.x5c);
  const pubKey = await importLeafPublicKey(leaf);

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

  return JSON.parse(b64urlDecodeToString(parts[1]));
}

export async function handleRequest(req: Request): Promise<Response> {
  {
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
  }
}

// Supabase Edge Runtime 은 모듈을 main 으로 실행하므로 항상 serve() 가 동작한다.
// (테스트에서 import 시에는 import.meta.main 이 false → handleRequest 만 직접 호출)
if (import.meta.main) {
  serve(handleRequest);
}
