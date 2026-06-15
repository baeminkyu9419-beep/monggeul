// Regression test (P1): Apple x5c chain MUST be anchored to a trusted root.
// 위조 self-signed JWS 거부(공격 차단), 신뢰 root 주입 시 서명검증 통과, 변조 서명 거부를 검증한다.
//
// 실행:
//   deno test --allow-net --allow-read --allow-env \
//     supabase/functions/billing-apple-notifications/index.x5c_chain.test.ts
//
// 함수는 import.meta.main 가드 덕분에 import 시 serve() 가 동작하지 않으므로
// verifyAppleJws 를 직접 호출해 단위 검증한다.
import * as x509 from "https://esm.sh/@peculiar/x509@1.12.3";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

// 함수 모듈이 top-level 에서 읽는 env 를 import 전에 주입.
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
Deno.env.set("APPLE_BUNDLE_ID", "com.monggeul.app");
Deno.env.set("APPLE_ENVIRONMENT", "sandbox");
Deno.env.set("APPLE_SIGNATURE_VERIFICATION", "true");

const C = globalThis.crypto;
x509.cryptoProvider.set(C);

const b64url = (b: Uint8Array) =>
  encodeBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

async function genEc() {
  return await C.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}
async function mintChain() {
  const rootKeys = await genEc();
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01", name: "CN=Test Root CA",
    notBefore: new Date(Date.now() - 3.6e6), notAfter: new Date(Date.now() + 8.6e7),
    keys: rootKeys, signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  const leafKeys = await genEc();
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: "02", subject: "CN=Test Leaf", issuer: root.subject,
    notBefore: new Date(Date.now() - 3.6e6), notAfter: new Date(Date.now() + 8.6e7),
    signingKey: rootKeys.privateKey, publicKey: leafKeys.publicKey,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  return { root, leaf, leafKeys };
}
const certB64 = (c: x509.X509Certificate) => encodeBase64(new Uint8Array(c.rawData));
async function fp256(c: x509.X509Certificate) {
  const d = await C.subtle.digest("SHA-256", c.rawData);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sign(payload: unknown, x5c: string[], key: CryptoKey) {
  const h = b64urlStr(JSON.stringify({ alg: "ES256", x5c }));
  const p = b64urlStr(JSON.stringify(payload));
  const sig = await C.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const samplePayload = {
  notificationType: "SUBSCRIBED",
  notificationUUID: "u1",
  data: { bundleId: "com.monggeul.app" },
};

// 각 시나리오마다 env 를 세팅하고 모듈을 fresh import (top-level env 캡처) 한다.
async function freshVerify() {
  const mod = await import(`./index.ts?ts=${Date.now()}-${Math.random()}`);
  return mod.verifyAppleJws as (jws: string) => Promise<any>;
}

Deno.test("ATTACK: forged self-signed x5c chain is REJECTED (untrusted_root_chain)", async () => {
  Deno.env.delete("APPLE_EXTRA_ROOT_FINGERPRINTS"); // no trusted root injected
  const verify = await freshVerify();
  const { root, leaf, leafKeys } = await mintChain();
  const x5c = [certB64(leaf), certB64(root)];
  const jws = await sign(samplePayload, x5c, leafKeys.privateKey);
  // 서명 자체는 유효하지만 root 가 신뢰되지 않으므로 reject 되어야 한다.
  await assertRejects(() => verify(jws), Error, "untrusted_root_chain");
});

Deno.test("ATTACK: single self-signed cert (length 1) is REJECTED", async () => {
  Deno.env.delete("APPLE_EXTRA_ROOT_FINGERPRINTS");
  const verify = await freshVerify();
  const rootKeys = await genEc();
  const selfSigned = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01", name: "CN=Attacker",
    notBefore: new Date(Date.now() - 3.6e6), notAfter: new Date(Date.now() + 8.6e7),
    keys: rootKeys, signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  const x5c = [encodeBase64(new Uint8Array(selfSigned.rawData))];
  const jws = await sign(samplePayload, x5c, rootKeys.privateKey);
  await assertRejects(() => verify(jws), Error, "untrusted_root_chain");
});

Deno.test("OK: trusted root (injected fp) + valid sig PASSES → returns payload", async () => {
  const { root, leaf, leafKeys } = await mintChain();
  Deno.env.set("APPLE_EXTRA_ROOT_FINGERPRINTS", await fp256(root));
  const verify = await freshVerify();
  const x5c = [certB64(leaf), certB64(root)];
  const jws = await sign(samplePayload, x5c, leafKeys.privateKey);
  const out = await verify(jws);
  assertEquals(out.notificationType, "SUBSCRIBED");
});

Deno.test("ATTACK: trusted root but TAMPERED signature is REJECTED (signature_invalid)", async () => {
  const { root, leaf } = await mintChain();
  const wrong = await genEc(); // 서명키가 leaf 공개키와 불일치
  Deno.env.set("APPLE_EXTRA_ROOT_FINGERPRINTS", await fp256(root));
  const verify = await freshVerify();
  const x5c = [certB64(leaf), certB64(root)];
  const jws = await sign(samplePayload, x5c, wrong.privateKey);
  await assertRejects(() => verify(jws), Error, "signature_invalid");
});

Deno.test("ATTACK: alg=none / non-ES256 is REJECTED", async () => {
  Deno.env.delete("APPLE_EXTRA_ROOT_FINGERPRINTS");
  const verify = await freshVerify();
  const { root, leaf } = await mintChain();
  const x5c = [certB64(leaf), certB64(root)];
  const h = b64urlStr(JSON.stringify({ alg: "none", x5c }));
  const p = b64urlStr(JSON.stringify(samplePayload));
  const jws = `${h}.${p}.`;
  await assertRejects(() => verify(jws), Error, "unsupported_alg");
});
