import { defineConfig } from 'vite';

export default defineConfig({
  base: '/monggeul/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          'tab-dream': ['./src/tabs/dream.js'],
          'tab-dali': ['./src/tabs/dali.js'],
          'tab-community': ['./src/tabs/community.js'],
          'tab-my': ['./src/tabs/my.js'],
          'data-symbols': ['./src/utils/symbols.js'],
          'data-dreams': ['./src/utils/dream-data.js'],
          'svc-community': ['./src/services/community-bot.js', './src/services/community-storage.js'],
          'svc-growth': ['./src/services/growth.js', './src/services/ads.js', './src/services/ab-test.js'],
        },
      },
    },
  },
});
