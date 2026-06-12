import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// [2026-05-28] base path 분기 — JARVIS_NEW 메모리 박제 배포 대안 (Cloudflare/Vercel/Netlify=루트, GitHub Pages=/monggeul/)
//   DEPLOY_BASE=/  → 루트 도메인용 (npm run deploy:cf|vercel|netlify)
//   미지정         → 기본 /monggeul/ (GitHub Pages, 기존 동작 유지 — 회귀 0)
const _base = process.env.DEPLOY_BASE || '/monggeul/';

export default defineConfig({
  base: _base,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      // [2026-06-12] 멀티페이지 — index(=앱 SPA) + landing(=마케팅 첫 진입) 둘 다 빌드 입력.
      //   기존: index.html 단일 입력 → landing.html 미빌드 → dist 에 stale 14KB public/landing.html 만 남음(배포 0%).
      //   변경: 리치 landing.html(워크스루/Lenis 포함) 을 dist/landing.html 로 산출. 앱 SPA 구조 불변.
      input: {
        index: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing.html'),
      },
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          // dream 영역 — 본 세션 분리 4 sub-module 별도 chunk
          'tab-dream': ['./src/tabs/dream.js'],
          'tab-dream-demo': ['./src/tabs/dream-demo.js'],
          'tab-dream-share': ['./src/tabs/dream-share.js'],
          'tab-dream-voice': ['./src/tabs/dream-voice.js'],
          'tab-dream-validator': ['./src/utils/dream-validator.js'],
          'tab-dali': ['./src/tabs/dali.js'],
          'tab-community': ['./src/tabs/community.js'],
          // my 영역 — 본 세션 분리 4 sub-module 별도 chunk (tab-my 535kB warning 해소)
          'tab-my': ['./src/tabs/my.js'],
          'tab-my-monthly': ['./src/tabs/my-monthly-report.js'],
          'tab-my-flow': ['./src/tabs/my-flow.js'],
          'tab-my-dict': ['./src/tabs/my-dict.js'],
          'tab-my-emotion-sleep': ['./src/tabs/my-emotion-sleep.js'],
          'data-symbols': ['./src/utils/symbols.js'],
          'data-dreams': ['./src/utils/dream-data.js'],
          'svc-community': ['./src/services/community-bot.js', './src/services/community-storage.js'],
          'svc-growth': ['./src/services/growth.js', './src/services/ads.js', './src/services/ab-test.js'],
        },
      },
    },
  },
});
