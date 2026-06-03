#!/usr/bin/env bash
# redeploy-security.sh — 보안수정(R4: 프롬프트 IP 서버 격리) 실효화 1-command 재배포
#
# 왜 필요한가:
#   commit 8ceceba 가 LLM 시스템 프롬프트를 클라 번들에서 edge function 서버로 옮겼다.
#   하지만 코드 커밋만으로는 실효 0 — 두 가지를 호스트가 재배포해야 한다:
#     (A) dist 재빌드 + 호스팅(Cloudflare/Vercel/Netlify/GitHub Pages) 재배포
#         → 사용자가 받는 번들에서 프롬프트 평문이 사라진다(=탈취 차단).
#     (B) supabase functions deploy openai-proxy
#         → 서버가 prompts.ts(buildChatPayload)로 프롬프트를 조립한다.
#     ★ (A) 만 하고 (B) 를 안 하면: 신규 클라가 {task,params} 만 보내는데
#        구버전 서버는 그걸 못 해석 → chat 깨짐. 반드시 함께 배포.
#
# 사용:
#   bash scripts/redeploy-security.sh            # 빌드 + R4 검증만 (배포 안 함, 안전 기본값)
#   bash scripts/redeploy-security.sh --check    # 위와 동일(명시)
#   bash scripts/redeploy-security.sh --deploy   # 빌드 + 검증 + 실배포(edge fn + Cloudflare Pages)
#   HOST=vercel  bash scripts/redeploy-security.sh --deploy   # 호스트 선택(cf|vercel|netlify, 기본 cf)
#
# 실배포(--deploy)는 supabase login / wrangler login 등 인증이 선행돼야 한다(민규 수동).
# 인증 없이 호출하면 CLI 가 로그인 안내를 띄우고 멈춘다(파괴적 동작 없음).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
MODE="${1:---check}"
HOST="${HOST:-cf}"

echo "==> MONGGEUL 보안 재배포  (mode=$MODE host=$HOST)"
echo "    repo: $ROOT"

# ── 1. 클린 빌드 (루트 도메인용 base=/) ─────────────────────────────
echo ""
echo "[1/4] npm run build  (DEPLOY_BASE=/)"
DEPLOY_BASE=/ npm run build

# ── 2. R4 검증: 프롬프트 IP 단편이 dist 에 평문 노출 0 인지 전수 grep ──
echo ""
echo "[2/4] R4 검증 — dist 프롬프트 IP 평문 노출 스캔"
# 서버에만 있어야 할 프롬프트 IP 단편 (prompts.ts 에서 추출, UI 라벨과 구분되는 지시문 문구)
FRAGMENTS=(
  "꿈 해석가"
  "해석 방법론"
  "따뜻한 친구"
  "이 사용자는 학생"
  "위로와 안심을 최우선"
  "반말+존댓말 믹스"
  "친구처럼 편하게"
)
LEAK=0
for frag in "${FRAGMENTS[@]}"; do
  # grep 무매칭(=PASS)은 exit 1 → pipefail 아래서 스크립트가 죽지 않도록 `|| true` 로 흡수
  hits=$(grep -rl "$frag" dist/assets/ 2>/dev/null || true)
  n=$(printf '%s' "$hits" | grep -c . || true)
  if [ "${n:-0}" -gt 0 ]; then
    echo "    LEAK  [$frag] -> $n file(s)  [X]"
    printf '%s\n' "$hits" | sed 's/^/          /'
    LEAK=1
  else
    echo "    clean [$frag]"
  fi
done
if [ "$LEAK" -ne 0 ]; then
  echo ""
  echo "❌ R4 FAIL — 프롬프트 IP 가 dist 번들에 평문 노출. 배포 중단."
  echo "   원인 후보: prompts.ts 격리 누락 / 클라가 system 프롬프트를 여전히 import."
  exit 1
fi
echo "    => R4 PASS (프롬프트 IP 평문 노출 0)"

# ── 3. edge function 서버측 프롬프트 조립 모듈 무결성 (transpile 체크) ──
echo ""
echo "[3/4] edge function 구문 체크 (esbuild transpile-only)"
for f in prompts.ts index.ts; do
  bytes=$(npx --yes esbuild "supabase/functions/openai-proxy/$f" \
            --format=esm --platform=neutral --log-level=error 2>/dev/null | wc -c | tr -d ' ')
  if [ "${bytes:-0}" -gt 0 ]; then
    echo "    ok    openai-proxy/$f  (transpiled ${bytes}B)"
  else
    echo "    FAIL  openai-proxy/$f  — 구문 오류. 배포 중단."
    exit 1
  fi
done

# ── 4. 배포 ────────────────────────────────────────────────────────
echo ""
if [ "$MODE" != "--deploy" ]; then
  echo "[4/4] (skip) 검증 전용 모드. 실배포하려면: bash scripts/redeploy-security.sh --deploy"
  echo ""
  echo "✅ 빌드+검증 통과. 실배포 명령(민규 인증 후):"
  echo "    supabase functions deploy openai-proxy   # 서버 프롬프트 조립 적용"
  echo "    npm run deploy:cf                          # 또는 deploy:vercel / deploy:netlify"
  exit 0
fi

echo "[4/4] 실배포"
echo "    (4a) edge function: supabase functions deploy openai-proxy"
supabase functions deploy openai-proxy
echo "    (4b) 호스트($HOST) 정적 배포"
case "$HOST" in
  cf)      npm run deploy:cf ;;
  vercel)  npm run deploy:vercel ;;
  netlify) npm run deploy:netlify ;;
  *) echo "    알 수 없는 HOST=$HOST (cf|vercel|netlify). 4b 건너뜀."; exit 1 ;;
esac

echo ""
echo "✅ 보안 재배포 완료 (edge fn + $HOST). R4 프롬프트 격리 실효화."
echo "   배포 후 확인: 라이브 URL → DevTools → Sources/Network 에서"
echo "   '꿈 해석가' 검색 0건이면 OK. chat 1회 호출해 해몽 정상 응답이면 (A)(B) 둘 다 적용된 것."
