import { defineConfig } from 'vite';

// 開發時 WS 走 /ws 代理到本機後端（apps/api，:3000）
export default defineConfig({
  server: {
    // F5 / launch.json 假設固定 5173：被占用時直接報錯，不要默默換 port
    strictPort: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        rewrite: () => '/',
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
});
