// 몽글몽글 Service Worker — 오프라인 캐싱 + 빠른 재방문
const CACHE_NAME = 'monggeul-v5';
const STATIC_ASSETS = [
  '/monggeul/',
  '/monggeul/manifest.json',
  '/monggeul/assets/cat_normal.png',
  '/monggeul/dreams/index.html',
];

// SEO 꿈 해몽 페이지 — 오프라인 캐시 대상
const SEO_PAGES = [
  '/monggeul/dreams/snake.html', '/monggeul/dreams/teeth.html', '/monggeul/dreams/money.html',
  '/monggeul/dreams/water.html', '/monggeul/dreams/falling.html', '/monggeul/dreams/chase.html',
  '/monggeul/dreams/pig.html', '/monggeul/dreams/poop.html', '/monggeul/dreams/ghost.html',
  '/monggeul/dreams/flying.html', '/monggeul/dreams/death.html', '/monggeul/dreams/fire.html',
  '/monggeul/dreams/dog.html', '/monggeul/dreams/cat.html', '/monggeul/dreams/fish.html',
  '/monggeul/dreams/baby.html', '/monggeul/dreams/sea.html', '/monggeul/dreams/rain.html',
  '/monggeul/dreams/dragon.html', '/monggeul/dreams/tiger.html', '/monggeul/dreams/spider.html',
  '/monggeul/dreams/car.html', '/monggeul/dreams/house.html', '/monggeul/dreams/school.html',
  '/monggeul/dreams/elevator.html', '/monggeul/dreams/stairs.html', '/monggeul/dreams/breakup.html',
  '/monggeul/dreams/wedding.html', '/monggeul/dreams/pregnancy.html', '/monggeul/dreams/hair.html',
  '/monggeul/dreams/blood.html', '/monggeul/dreams/flower.html', '/monggeul/dreams/bird.html',
  '/monggeul/dreams/horse.html', '/monggeul/dreams/bear.html', '/monggeul/dreams/lion.html',
  '/monggeul/dreams/rabbit.html', '/monggeul/dreams/turtle.html', '/monggeul/dreams/river.html',
  '/monggeul/dreams/mountain.html', '/monggeul/dreams/bridge.html', '/monggeul/dreams/train.html',
  '/monggeul/dreams/knife.html', '/monggeul/dreams/mirror.html', '/monggeul/dreams/phone.html',
  '/monggeul/dreams/naked.html', '/monggeul/dreams/exam.html', '/monggeul/dreams/hospital.html',
  '/monggeul/dreams/prison.html', '/monggeul/dreams/war.html', '/monggeul/dreams/snow.html',
  '/monggeul/dreams/earthquake.html', '/monggeul/dreams/cloud.html', '/monggeul/dreams/tree.html',
  '/monggeul/dreams/door.html', '/monggeul/dreams/key.html', '/monggeul/dreams/food.html',
  '/monggeul/dreams/clothes.html', '/monggeul/dreams/butterfly.html', '/monggeul/dreams/ant.html',
  '/monggeul/dreams/crow.html', '/monggeul/dreams/airplane.html', '/monggeul/dreams/swimming.html',
  '/monggeul/dreams/grandparent.html', '/monggeul/dreams/teacher.html', '/monggeul/dreams/lover.html',
  '/monggeul/dreams/teeth-growing.html',
];

// 설치 — 핵심 에셋 + SEO 페이지 캐시
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).then(() =>
        // SEO 페이지는 백그라운드에서 캐시 (실패해도 설치 차단 안 함)
        Promise.allSettled(SEO_PAGES.map(url => cache.add(url)))
      )
    )
  );
  self.skipWaiting();
});

// 활성화 — 이전 캐시 정리
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 처리
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API 요청은 항상 네트워크 우선
  if (url.pathname.includes('/functions/') || url.hostname !== location.hostname) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // SEO 꿈 페이지 (/dreams/*.html) — stale-while-revalidate
  if (url.pathname.startsWith('/monggeul/dreams/') && url.pathname.endsWith('.html')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Vite 해시 에셋 (immutable) — 캐시 우선
  if (url.pathname.match(/\/assets\/.*-[a-zA-Z0-9]{8}\.(js|css|png|jpg|svg|woff2?)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 정적 에셋 (비해시) — stale-while-revalidate
  if (e.request.destination === 'image' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // HTML — 네트워크 우선, 실패 시 캐시
  e.respondWith(
    fetch(e.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      return response;
    }).catch(() => caches.match(e.request))
  );
});

// ── 웹 푸시 알림 ──
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const type = data.type || 'general';
  const title = data.title || '🌙 몽글몽글';

  // 알림 유형별 기본 메시지
  const defaults = {
    morning: { body: '어젯밤 꿈을 기록해 보세요!', tag: 'monggeul-morning', url: '/monggeul/?tab=dream' },
    pattern: { body: '반복꿈 주기가 다가왔어요', tag: 'monggeul-pattern', url: '/monggeul/?tab=log' },
    dali_weekly: { body: '달이가 이번 주 꿈을 정리해뒀어요', tag: 'monggeul-dali', url: '/monggeul/?tab=chat' },
    general: { body: '어젯밤 꿈을 기록해 보세요!', tag: 'monggeul-daily', url: '/monggeul/' },
  };
  const d = defaults[type] || defaults.general;

  const options = {
    body: data.body || d.body,
    icon: '/monggeul/assets/cat_normal.png',
    badge: '/monggeul/assets/cat_normal.png',
    tag: data.tag || d.tag,
    data: { url: data.url || d.url, type },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/monggeul/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 이미 열린 창이 있으면 포커스 + 네비게이션
      for (const c of list) {
        if (c.url.includes('/monggeul/') && 'focus' in c) {
          c.focus();
          c.postMessage({ type: 'notif_click', url, notifType: e.notification.data?.type });
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
