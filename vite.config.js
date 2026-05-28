import { defineConfig } from 'vite';

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
