// Supabase Edge Functions 공용 모듈 — 운영자 알림 (Discord webhook)
// 위치 규약: supabase/functions/_shared/ — '_' 시작 디렉토리는 함수로 배포되지 않는
// 공용 모듈 자리(Supabase 공식 컨벤션). 각 함수에서 ../_shared/notify-ops.ts 상대 import.
//
// 목적 (2026-06-13 감사 P0-1): 결제 실패·취소/환불·웹훅 서명 거부·처리 예외를
// 운영자(민규)가 즉시 알 수 있는 채널이 코드에 전무했다 — Discord webhook 1채널 신설.
//
// 설계 불변식:
//   1) 절대 throw 하지 않는다 — 알림 실패가 결제 흐름을 죽이면 본말전도. 전체 try/catch.
//   2) DISCORD_OPS_WEBHOOK 미설정 = silent skip (콘솔 1줄) — 로컬/스테이징 무해.
//   3) 시크릿·카드정보를 본문에 넣지 않는다 — 호출부 책임(orderId·코드·메시지만)
//      + 여기서는 Discord content 한도(2000자) 대비 절단만 수행.
export async function notifyOps(text: string): Promise<void> {
  try {
    const url = Deno.env.get('DISCORD_OPS_WEBHOOK')
    if (!url) {
      console.log(`[notifyOps] skip (DISCORD_OPS_WEBHOOK unset): ${text.slice(0, 200)}`)
      return
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Discord content 한도 2000자 — 여유 두고 절단
      body: JSON.stringify({ content: `[monggeul] ${text}`.slice(0, 1900) }),
    })
    if (!res.ok) console.error(`[notifyOps] discord ${res.status}`)
  } catch (e) {
    // 알림 실패는 삼킨다 (불변식 1) — 결제/웹훅 응답에 영향 금지
    console.error('[notifyOps] failed:', e?.message ?? e)
  }
}
