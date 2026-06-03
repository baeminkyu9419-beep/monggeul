# MONGGEUL 보안 재배포 가이드 — R4 프롬프트 IP 서버 격리 실효화

> 대상 커밋: `8ceceba` `fix(security): LLM 시스템 프롬프트 IP를 edge function 서버로 격리`
> 이 문서는 **그 커밋을 라이브에 실효화**하는 절차다. 코드 커밋만으로는 보안 0 — 호스트가 재배포해야 한다.

---

## 0. 왜 재배포가 "보안 그 자체"인가

R4 이전: 꿈 해석가 페르소나·해석 방법론·달이 채팅 지시문·lifeStage 지시문·월간리포트
프롬프트가 **클라이언트 번들(`dist/assets/*.js`)에 평문**으로 들어가 있었다.
→ 누구나 라이브 사이트에서 DevTools 열고 그 IP(영업비밀)를 통째로 복사 가능했다(기술 탈취).

R4 수정: 프롬프트 조립을 edge function 서버(`supabase/functions/openai-proxy/prompts.ts`)로
이동. 클라는 `{ task, params }` (사용자 본인 꿈 데이터)만 보내고, 서버가 시스템 프롬프트를 만든다.

**그래서 두 가지를 반드시 함께 재배포해야 실효한다:**

| | 배포 대상 | 안 하면 |
|---|---|---|
| **(A)** | `dist` 재빌드 → 호스팅 재배포 | 사용자는 여전히 옛 번들(프롬프트 평문)을 받음 = 탈취 가능 |
| **(B)** | `supabase functions deploy openai-proxy` | 서버가 `{task,params}`를 못 해석 → **chat 깨짐**(해몽 응답 실패) |

> ⚠️ **(A)만 하고 (B)를 빠뜨리면 앱이 깨진다.** 신규 클라는 messages를 안 보내는데
> 구버전 서버는 messages를 기대하기 때문이다. **A·B는 한 세트.**

---

## 1. 한 줄 재배포 (권장)

검증과 배포가 한 스크립트에 묶여 있다. R4 누출 검사(전수 grep)가 빌드 직후 자동 실행되어,
프롬프트가 번들에 새면 **배포를 멈춘다**(fail-closed).

```bash
# (검증만 — 배포 안 함, 안전 기본값) 빌드 + R4 누출 스캔 + edge fn 구문 체크
bash scripts/redeploy-security.sh --check

# (실배포) 위 검증 통과 후 edge function + 호스트 정적 배포까지
bash scripts/redeploy-security.sh --deploy            # 호스트=Cloudflare Pages(기본)
HOST=vercel  bash scripts/redeploy-security.sh --deploy
HOST=netlify bash scripts/redeploy-security.sh --deploy
```

Windows PowerShell:
```powershell
pwsh scripts/redeploy-security.ps1            # 검증만
pwsh scripts/redeploy-security.ps1 -Deploy    # 실배포(cf)
pwsh scripts/redeploy-security.ps1 -Deploy -Host vercel
```

> `--deploy`는 `supabase login` / `wrangler login`(또는 vercel/netlify 로그인) 인증이
> **선행**돼야 한다(민규 수동, 아래 2절). 인증 없이 호출하면 CLI가 로그인 안내를 띄우고
> 멈춘다 — **파괴적 동작 없음**.

스크립트가 하는 일(4단계):
1. `DEPLOY_BASE=/ npm run build` — 루트 도메인용 클린 빌드
2. **R4 누출 스캔** — 7개 프롬프트 IP 단편이 `dist/assets/`에 평문 0건인지 전수 grep. 누출 시 **중단**.
3. edge function 구문 체크 — `prompts.ts` / `index.ts` esbuild transpile(구문 오류 시 중단)
4. (`--deploy`일 때만) `supabase functions deploy openai-proxy` + `npm run deploy:<host>`

---

## 2. 수동 절차 (스크립트를 안 쓸 때 / 최초 1회 인증)

### 2-1. Supabase 인증 + 프로젝트 연결 (최초 1회)
```bash
supabase login                                  # 브라우저 인증
supabase link --project-ref mskwqlqpcsfvgvhhilma   # 몽글몽글 프로젝트
```
> project-ref `mskwqlqpcsfvgvhhilma` = `supabase/.temp/project-ref`에 박제된 현재 인스턴스.
> (Supabase 프로젝트가 일시정지 상태면 대시보드에서 먼저 unpause.)

### 2-2. (B) edge function 배포 — 서버 프롬프트 조립 적용
```bash
supabase functions deploy openai-proxy
```
> `openai-proxy`만 배포하면 된다(R4는 이 함수만 건드림). 결제 함수는 `DEPLOY_GUIDE.md` 참조.
> 이 함수는 JWT 검증을 내부에서 하므로 `--no-verify-jwt` 쓰지 말 것.

### 2-3. (A) dist 빌드 + 호스트 정적 배포 — 1 command
```bash
# Cloudflare Pages (무료, private repo 무제한, 권장)
npm run deploy:cf        # = build:root + wrangler pages deploy dist

# 또는 Vercel
npm run deploy:vercel    # = build:root + vercel --prod ./dist

# 또는 Netlify
npm run deploy:netlify   # = build:root + netlify deploy --dir=dist --prod
```
세 호스트 모두 SPA fallback이 구성돼 있다(`dist/_redirects`, `vercel.json`, `netlify.toml`).

> **GitHub 연동 자동 배포(가장 손 안 가는 방식):** Cloudflare 대시보드 → Pages →
> Connect to Git → repo 선택 → build command `npm run build`, output `dist`.
> 그러면 `git push` 할 때마다 자동 재배포된다(이때 빌드는 base=`/monggeul/`가 아니라
> 루트가 되도록 환경변수 `DEPLOY_BASE=/`를 Pages 빌드 설정에 추가).

---

## 3. Supabase Secrets — LLM 키 배선 (Mistral 단일 우선)

`openai-proxy`는 환경변수(Secrets)에서 LLM 키를 읽는다. **키가 있는 provider만 활성**되며,
우선순위는 `index.ts`의 `PROVIDERS` 배열 순서다:

```
1) MISTRAL_API_KEY   (mistral-small-latest)  enabled  ← 1차 (현재 유일 생존 키)
2) GEMINI_API_KEY    (gemini-2.5-flash-lite) enabled  ← 키 있으면 2차/consensus
3) DEEPSEEK_API_KEY  (deepseek-chat)         enabled
4) OPENAI_API_KEY    (gpt-4o)                disabled ← 무효 키, 복구 시 코드에서 enabled:true
```

> 근거: JARVIS_NEW 키 ping 매트릭스 실측 — **LIVE=Mistral 1개**, 나머지(OpenAI/Gemini/DeepSeek)는
> 만료/무효/부재. 따라서 **MISTRAL_API_KEY 하나만 설정해도 chat(해몽·달이)이 작동한다.**

### 3-1. 키 설정 (CLI)
```bash
# Mistral 단일 (최소 — 이것만으로 작동)
supabase secrets set MISTRAL_API_KEY=<몽글몽글_MISTRAL_키> --project-ref mskwqlqpcsfvgvhhilma

# (선택) 추가 LLM 충전 시 — consensus(교차검증) 품질용
supabase secrets set GEMINI_API_KEY=<...> --project-ref mskwqlqpcsfvgvhhilma

# 인증/백엔드 (edge fn이 JWT 검증·rate limit RPC에 사용)
supabase secrets set SUPABASE_URL=https://mskwqlqpcsfvgvhhilma.supabase.co --project-ref mskwqlqpcsfvgvhhilma
supabase secrets set SUPABASE_ANON_KEY=<anon_key> --project-ref mskwqlqpcsfvgvhhilma
```
> Supabase는 함수 런타임에 `SUPABASE_URL`·`SUPABASE_ANON_KEY`를 보통 자동 주입한다.
> 만약 함수가 503 `Auth backend not configured`를 내면 위처럼 명시 설정한다.

### 3-2. 키 설정 (대시보드)
Supabase Dashboard → Project → **Edge Functions → Secrets** (또는 Settings → Edge Functions →
Environment Variables) 에서 위 키들을 입력 → Save → **함수 재배포(2-2)** 해야 반영된다.

### 3-3. 설정 확인
```bash
supabase secrets list --project-ref mskwqlqpcsfvgvhhilma   # 키 이름만 표시(값은 마스킹)
```

---

## 4. 배포 후 검증 (실효 확인)

### 4-1. (A) 번들에서 프롬프트 평문 사라졌는지 — 라이브에서 직접
1. 배포된 URL 접속 → DevTools(F12) → **Sources** 탭 → `assets/*.js` 전체에서
   `꿈 해석가` 검색 → **0건이면 OK**.
2. 또는 로컬에서 같은 검사:
   ```bash
   bash scripts/redeploy-security.sh --check   # R4 PASS 출력이면 빌드 산출물 깨끗
   ```

### 4-2. (B) 서버 프롬프트 조립 작동하는지 — chat 1회
- 라이브 앱에서 **꿈 1개 입력 → 해몽 실행** → 해석 응답이 정상으로 나오면
  `{task,params}` → 서버 `buildChatPayload` → LLM 경로가 (A)(B) 둘 다 적용된 것.
- 응답이 안 나오면: edge fn 배포 누락(2-2) 또는 `MISTRAL_API_KEY` 미설정(3-1) 의심.
  Supabase Dashboard → Edge Functions → openai-proxy → **Logs** 확인
  (`NO_LLM_KEY` = 키 없음 / `Unauthorized` = JWT / `Invalid task` = 클라-서버 계약 불일치).

### 4-3. 인젝션 가드 (서버 단위 스모크 — 로컬, 키 불요)
`buildChatPayload`가 클라가 주입한 `role:'system'`을 필터링하고, 잘못된 task를 거부하는지:
```bash
# (스크립트 내부 transpile 체크와 별개) 4 task + 인젝션/invalid-task 스모크는
# redeploy-security.sh 가 빌드 시 구문 체크로 커버. 더 깊은 스모크가 필요하면
# supabase functions serve 로 로컬 기동 후 {task:'dali_chat', history:[{role:'system',...}]}
# 를 보내 응답에 주입 문자열이 안 섞이는지 확인.
```

---

## 5. 체크리스트 (출시 시)

- [ ] `bash scripts/redeploy-security.sh --check` → **R4 PASS** (프롬프트 누출 0)
- [ ] `supabase login` + `supabase link --project-ref mskwqlqpcsfvgvhhilma` (최초 1회)
- [ ] `supabase secrets set MISTRAL_API_KEY=...` (LLM 최소 1키)
- [ ] **(B)** `supabase functions deploy openai-proxy`
- [ ] **(A)** `npm run deploy:cf` (또는 vercel/netlify, 또는 GitHub 연동 자동배포)
- [ ] 라이브 DevTools에서 `꿈 해석가` 검색 → **0건**
- [ ] 라이브에서 해몽 1회 → 정상 응답 (서버 프롬프트 경로 작동)
- [ ] (정지돼 있었다면) Supabase 프로젝트 unpause

---

## 부록 — 책임 경계

- **자율(코드/문서/스크립트):** 빌드·R4 검증·구문 체크·이 문서·재배포 스크립트.
- **민규 수동(실배포·실키):** `supabase login`, 실제 `--deploy`, `MISTRAL_API_KEY` 실값,
  도메인 연결, 호스팅 계정 인증 — 외부 인증/실자금/비가역 영역이라 자율 범위 밖.
