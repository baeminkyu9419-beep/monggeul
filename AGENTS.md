# MONGGEUL AGENTS

## 개요
바닐라JS + Vite 프론트엔드. 꿈해몽 서비스. 패키지 매니저: **npm** (package-lock.json 존재, pnpm 아님).
dream.js / my.js는 `src/tabs/` 하위 8개 분리 모듈로 존재.

## 실행·빌드
```
npm install            # 의존성 설치
npm run dev            # Vite 개발 서버
npm run build          # SEO 생성 + Vite 빌드 + config 생성
npm run preview        # 빌드 결과물 로컬 미리보기
npm run deploy:cf      # Cloudflare Pages 배포
npm run deploy:vercel  # Vercel 배포
npm run deploy:netlify # Netlify 배포
```

## 테스트
테스트는 `tests/` 하위 Python pytest 파일 (`test_*.py`).  
Playwright E2E는 **미설치** — 메모리 상 "뱀 → [뱀] 재물이 온다" 시나리오는 Puppeteer(devDependency) 기반으로 검증됐던 것. 현재 실행 가능한 테스트:
```
cd tests && python -m pytest test_business_logic.py test_edge_llm_routing.py -v
```

## INTERFACE (machine-readable)
```yaml
build: npm run build
test: cd tests && python -m pytest -q
run: npm run dev
deploy: npm run deploy:cf (대안 deploy:vercel/deploy:netlify). blocker=Supabase unpause·LLM 키·repo public(민규 P0)
healthcheck: none
```
(T1 표준 — 파서: `PYTHONUTF8=1 python C:/JARVIS_NEW/tools/repo_interface.py`. test 실측: 253 collected/0 errors 2026-06-11)

## LLM·키 현실
꿈해몽 LLM 경로: `config.js` → openai-proxy 멀티 LLM(OpenAI / DeepSeek / Gemini) → fallback=키워드 demoResult.  
**현재 작동 키 0/3** (OpenAI 401·DeepSeek 부재·Gemini expired).  
config 빈값 상태면 LLM 없이 키워드 매칭 demoResult로 폴백 — 의도 파악 품질 급락.  
실 가용 LLM: **Mistral 1개뿐** → Mistral 단일 라우팅이 현실 경로.

## Blocker — 인간 영역 (코드로 해결 불가)
- Supabase 인스턴스 pause 해제 (1-click unpause)
- config Secrets / Vault LLM 키 발급 (OpenAI·DeepSeek·Gemini 또는 Mistral 등록)
- GitHub repo public 전환 (현재 private → LIVE 사이트 다운 원인)
- Supabase `mskwqlqpcsfvgvhhilma.supabase.co` ECONNREFUSED (인스턴스 pause 연동)

## 주의
- `config.js`는 `.gitignore`에 포함 — 커밋 시 `config.example.js` 참조.
- 결제 경로 수정 시 중복 webhook / idempotency 처리 필수.
- `src/tabs/dream.js` 등 모듈 경계 변경 시 import 체인 전수 확인.

## PURPOSE LOCK
- 목적 잠금 정본 = `PURPOSE.lock.yaml` (프로젝트·폴더·파일 목적/보호 분류). 구조 변경 시 함께 갱신.
- 검증: `PYTHONUTF8=1 python C:/JARVIS_NEW/tools/purpose_lock.py` (drift = 실패)
