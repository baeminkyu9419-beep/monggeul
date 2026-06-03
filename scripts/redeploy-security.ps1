# redeploy-security.ps1 — 보안수정(R4: 프롬프트 IP 서버 격리) 실효화 1-command 재배포 (Windows)
#
# bash 판(redeploy-security.sh)과 동일 절차. Windows PowerShell 호스트용.
#
# 사용:
#   pwsh scripts/redeploy-security.ps1            # 빌드 + R4 검증만(배포 안 함, 안전 기본값)
#   pwsh scripts/redeploy-security.ps1 -Deploy    # 빌드 + 검증 + 실배포(edge fn + Cloudflare Pages)
#   pwsh scripts/redeploy-security.ps1 -Deploy -Host vercel   # 호스트 cf|vercel|netlify (기본 cf)
#
# 실배포(-Deploy)는 supabase login / wrangler login 인증이 선행돼야 한다(민규 수동).
param(
  [switch]$Deploy,
  [ValidateSet('cf','vercel','netlify')]
  [string]$Host = 'cf'
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = (Get-Location).Path
$mode = if ($Deploy) { '--deploy' } else { '--check' }
Write-Host "==> MONGGEUL 보안 재배포  (mode=$mode host=$Host)"
Write-Host "    repo: $root"

# 1. 클린 빌드
Write-Host "`n[1/4] npm run build  (DEPLOY_BASE=/)"
$env:DEPLOY_BASE = '/'
npm run build
if ($LASTEXITCODE -ne 0) { throw "build 실패" }

# 2. R4 검증 — dist 프롬프트 IP 평문 노출 0
Write-Host "`n[2/4] R4 검증 — dist 프롬프트 IP 평문 노출 스캔"
$fragments = @('꿈 해석가','해석 방법론','따뜻한 친구','이 사용자는 학생','위로와 안심을 최우선','반말+존댓말 믹스','친구처럼 편하게')
$leak = $false
$files = Get-ChildItem -Path 'dist/assets' -Filter *.js -File -ErrorAction SilentlyContinue
foreach ($frag in $fragments) {
  $hit = $files | Where-Object { (Get-Content $_.FullName -Raw -Encoding UTF8) -match [regex]::Escape($frag) }
  if ($hit) {
    Write-Host "    LEAK  [$frag] -> $($hit.Count) file(s)  [X]"
    $hit | ForEach-Object { Write-Host "          $($_.Name)" }
    $leak = $true
  } else {
    Write-Host "    clean [$frag]"
  }
}
if ($leak) {
  Write-Host "`n[X] R4 FAIL — 프롬프트 IP 가 dist 번들에 평문 노출. 배포 중단."
  exit 1
}
Write-Host "    => R4 PASS (프롬프트 IP 평문 노출 0)"

# 3. edge function 구문 체크
Write-Host "`n[3/4] edge function 구문 체크 (esbuild transpile-only)"
foreach ($f in @('prompts.ts','index.ts')) {
  $out = npx --yes esbuild "supabase/functions/openai-proxy/$f" --format=esm --platform=neutral --log-level=error 2>$null
  if (($out | Measure-Object -Character).Characters -gt 0) {
    Write-Host "    ok    openai-proxy/$f"
  } else {
    Write-Host "    FAIL  openai-proxy/$f — 구문 오류. 배포 중단."
    exit 1
  }
}

# 4. 배포
if (-not $Deploy) {
  Write-Host "`n[4/4] (skip) 검증 전용 모드. 실배포: pwsh scripts/redeploy-security.ps1 -Deploy"
  Write-Host "`n[OK] 빌드+검증 통과. 실배포 명령(민규 인증 후):"
  Write-Host "    supabase functions deploy openai-proxy"
  Write-Host "    npm run deploy:cf   # 또는 deploy:vercel / deploy:netlify"
  exit 0
}
Write-Host "`n[4/4] 실배포"
Write-Host "    (4a) edge function: supabase functions deploy openai-proxy"
supabase functions deploy openai-proxy
Write-Host "    (4b) 호스트($Host) 정적 배포"
switch ($Host) {
  'cf'      { npm run deploy:cf }
  'vercel'  { npm run deploy:vercel }
  'netlify' { npm run deploy:netlify }
}
Write-Host "`n[OK] 보안 재배포 완료 (edge fn + $Host). R4 프롬프트 격리 실효화."
