# 몽글몽글 유입 실행 킷 (TRAFFIC LAUNCH KIT)

작성 2026-06-14. 목적 = "6개월 무수익"의 진짜 원인(유입 0)을 닫는다.
**코드/SEO는 이미 완료**(아래 §0 증거). 남은 건 검색엔진 제출 + 첫 노출 — 민규님 계정 행동이라 자동화 불가지만, 여기 적힌 대로 복붙하면 ~15분.

라이브: https://baeminkyu9419-beep.github.io/monggeul/
사이트맵: https://baeminkyu9419-beep.github.io/monggeul/sitemap.xml

---

## §0 SEO 현황 — 이미 완료된 것 (라이브 실측 2026-06-14)
- 메인/랜딩: title·meta description·canonical·OG(1200×630)·Twitter card·JSON-LD 풀세트, noindex 없음.
- 꿈 키워드 롱테일 페이지 **67개**(`뱀 꿈 해몽`·`돈 꿈 해몽`·`이빨 빠지는 꿈 해몽`…) 전부 개별 title/description/canonical + JSON-LD, sitemap 등록.
- robots.txt(네이버 Yeti·다음 허용) + sitemap.xml(68 URL) + feed.xml + og-image 존재.
- **이번 커밋 추가**: 메인(index.html)·랜딩(landing.html)에서 67개 꿈 페이지로 가는 내부링크(고아 페이지 → 홈 권위 전달). 검색 색인·랭킹에 직접 기여.

→ **결론: 기술 SEO는 닫혔다. 남은 단 하나 = 검색엔진에 "여기 있다"고 알리는 것(아래 §1~§2). 이게 유입 0의 실제 원인.**

---

## §1 구글 서치 콘솔 (필수, ~5분)
1. https://search.google.com/search-console 접속 (민규님 구글 계정).
2. 좌상단 속성 추가 → **URL 접두어** 선택 → 붙여넣기:
   `https://baeminkyu9419-beep.github.io/monggeul/`
3. 소유권 확인 = **HTML 태그** 방식 선택 → 나오는 `<meta name="google-site-verification" content="...">` 한 줄 복사.
   - 그 한 줄을 저(자비스)에게 주시면 `index.html` `<head>`에 1초 안에 넣고 재배포합니다. (또는 직접: index.html `<head>` 안 아무 곳에 붙여넣기 → 커밋/푸시)
4. 확인 완료 후 → 좌측 **Sitemaps** → 사이트맵 URL 입력란에 `sitemap.xml` 입력 → 제출.
5. (선택) 좌측 **URL 검사**에 홈 URL 넣고 "색인 생성 요청" 클릭 = 첫 크롤 가속.

## §2 네이버 서치어드바이저 (한국 트래픽엔 필수, ~5분)
1. https://searchadvisor.naver.com/ → 웹마스터 도구 → 사이트 등록.
2. 사이트 URL: `https://baeminkyu9419-beep.github.io/monggeul/`
3. 소유확인 = **HTML 태그** → `<meta name="naver-site-verification" content="...">` 한 줄 복사 → 저에게 주시면 index.html에 넣고 재배포(구글 태그와 같이 한 번에).
4. 등록 후 → **요청 > 사이트맵 제출**: `https://baeminkyu9419-beep.github.io/monggeul/sitemap.xml`
5. **요청 > RSS 제출**: `https://baeminkyu9419-beep.github.io/monggeul/feed.xml`

## §3 (선택) 빙/다음
- 빙: https://www.bing.com/webmasters → 구글 서치콘솔에서 **가져오기**(import) 한 번이면 끝.
- 다음: 네이버·구글 색인되면 자연 수집(robots에 다음 봇 허용돼 있음).

## §4 (선택·승인 필요) 루트 robots.txt 자동발견 보강
지금 `baeminkyu9419-beep.github.io/robots.txt`(루트)는 404다 — GitHub 프로젝트 페이지 구조상 robots는 `/monggeul/`이 아니라 호스트 루트에서만 읽힌다. **404 = "전부 크롤 허용"이라 색인은 안 막힌다**(차단 아님). 다만 robots의 `Sitemap:` 자동발견은 못 쓴다 → §1·§2 수동 제출이 정답이라 실질 영향 작음.
완전히 닫으려면 사용자 사이트 repo(`baeminkyu9419-beep.github.io`)에 루트 robots.txt를 두면 된다. **새 공개 repo 생성이라 민규님 승인 후** 제가 실행 가능:
```
gh repo create baeminkyu9419-beep.github.io --public
# 루트에 robots.txt(Sitemap: https://baeminkyu9419-beep.github.io/monggeul/sitemap.xml) 추가 후 push
```

---

## §5 첫 노출 — 바로 붙여넣는 런치 글 (유입의 실제 트리거)
색인은 "발견될 자격"이고, 첫 방문/백링크가 "실제 발견"이다. 아래 복붙용.

### (A) X / 스레드 / 인스타 캡션 — 짧게
```
🌙 어젯밤 꿈, 무슨 의미였을까?
뱀 꿈, 이빨 빠지는 꿈, 쫓기는 꿈… 67가지 꿈 해몽을 무료로.
달이가 길몽·흉몽·운세까지 풀어줘요. 가입 없이 1회 체험.
https://baeminkyu9419-beep.github.io/monggeul/
#꿈해몽 #해몽 #꿈풀이 #오늘의운세
```

### (B) 커뮤니티 글 (디시 점·타로 갤 / 더쿠 / 에펨 / 네이버 카페) — 중간
```
제목: 꿈 기록 + 해몽 해주는 거 만들어봤어요 (무료, 가입X)

자다 깨서 "이 꿈 뭐지" 싶을 때 검색하면 글마다 말이 다 달라서,
꿈 입력하면 상황별로 해몽해주고 기록도 쌓이는 걸 만들었어요.
- 뱀/돈/이빨/불/물/아기/쫓기는 꿈 등 자주 꾸는 67가지 사전 정리
- 가입 없이 1회 무료 체험, 로그인하면 매일 2개까지
- 꿈이 쌓이면 무의식 패턴(욕구·불안·성장)도 분석

링크: https://baeminkyu9419-beep.github.io/monggeul/
피드백 주시면 반영할게요 🙏
```

### (C) 블로그/네이버 포스팅 — 길게 (꿈 키워드 백링크용)
```
제목: 자주 꾸는 꿈 해몽 정리 (뱀·이빨·쫓기는 꿈 의미)

요즘 꿈 해몽을 정리하다가 좋은 사이트를 찾아서 공유해요.
- 뱀 꿈: 재물운·지혜·변화의 상징 → https://baeminkyu9419-beep.github.io/monggeul/dreams/snake.html
- 이빨 빠지는 꿈: 상실·불안·전환 → https://baeminkyu9419-beep.github.io/monggeul/dreams/teeth.html
- 쫓기는 꿈: 회피하는 현실의 신호 → https://baeminkyu9419-beep.github.io/monggeul/dreams/chase.html
전체 사전: https://baeminkyu9419-beep.github.io/monggeul/dreams/
꿈을 직접 입력해 해몽받고 기록도 가능해요: https://baeminkyu9419-beep.github.io/monggeul/
```
> 블로그/카페 본문에 dreams 개별 링크를 넣으면 그게 백링크 = 색인·랭킹 가장 강한 신호.

---

## §6 닫힘 판정 (이 킷이 끝나는 조건)
- [ ] 구글 서치콘솔 소유확인 + sitemap 제출
- [ ] 네이버 서치어드바이저 소유확인 + sitemap·feed 제출
- [ ] 런치 글 1개 이상 실제 게시(첫 백링크/유입)
- [ ] 3~7일 후 `site:baeminkyu9419-beep.github.io/monggeul` 구글 검색으로 색인 수 확인

※ 결제(실수익) 전환은 별개 트랙: 현재 라이브는 데모모드 — 실결제는 결제 키(민규님) 주입 후. 유입이 먼저 생겨야 결제 전환을 측정할 의미가 생긴다.
