// 오로라 스크롤 폴리시 — landing.html 의 Lenis풍 관성 + 오로라 패럴랙스를 앱에 이식.
//   [중요] 앱은 window 가 아니라 .page(overflow-y:auto) 가 스크롤된다(SPA 고정 뷰포트).
//   그래서 landing 의 window-scroll Lenis 를 그대로 쓰면 무동작이다. 대신:
//     - 활성 .page 의 scrollTop 을 읽어 #sky 의 --sky-y 를 미세 보간(lerp)으로 구동.
//     - 스크롤 자체는 네이티브 유지(휠/터치/중첩 스크롤러 안전, 기능 0 변경) — 관성은 오로라 드리프트로만 표현.
//     - prefers-reduced-motion 이면 통째 비활성.
//   transform/CSS변수 전용. SPA 구조·탭 전환·결제/인증 무관.

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PARALLAX = 0.06;   // 스크롤의 6% 만큼 위로 — landing 과 동일 톤
const LERP = 0.09;       // landing Lenis lerp 와 동일(부드러운 관성 드리프트)

export function initAuroraScroll() {
  if (REDUCED) return;
  const sky = document.getElementById('sky');
  if (!sky) return;

  let current = 0;   // 화면에 적용 중인 보간값(px)
  let target = 0;    // 활성 .page scrollTop 기반 목표값(px)
  let last = null;

  function activePage() {
    return document.querySelector('.pages > .page.active');
  }

  function onScroll(e) {
    const el = e && e.target;
    if (el && el.classList && el.classList.contains('page') && el.classList.contains('active')) {
      target = -(el.scrollTop * PARALLAX);
    }
  }
  // 캡처 단계로 .page 의 스크롤을 듣는다(개별 페이지에 바인딩하지 않아 탭 전환에도 견고).
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // 탭 전환/초기: 활성 페이지의 현재 스크롤을 목표로 동기화
  function syncTarget() {
    const p = activePage();
    target = p ? -(p.scrollTop * PARALLAX) : 0;
  }

  function frame(now) {
    const diff = target - current;
    if (Math.abs(diff) < 0.08) {
      current = target;
    } else {
      const dt = last != null ? Math.min((now - last) / 16.667, 3) : 1;
      current += diff * (1 - Math.pow(1 - LERP, dt));
    }
    last = now;
    sky.style.setProperty('--sky-y', current.toFixed(1) + 'px');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 탭 비활성→복귀, 윈도우 리사이즈 시 목표 재동기화(점프 방지)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTarget(); });
  window.addEventListener('resize', syncTarget, { passive: true });
  // 탭 버튼 클릭 후 다음 프레임에 동기화(전환 애니메이션과 독립)
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t && t.closest && t.closest('.tabbar, [data-tab], .tab-btn, .nav-item')) {
      requestAnimationFrame(() => requestAnimationFrame(syncTarget));
    }
  }, { passive: true });

  syncTarget();
}
