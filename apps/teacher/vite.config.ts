import { defineConfig } from 'vite';

// 老師後台 — 生產環境由 FastAPI 以 /teacher 服務 index.html，
// 打包出來的 assets 掛在 /teacher-assets/ 底下（所以 base 固定指到那）。
// 開發時 REST 與 WS 都代理到本機後端（apps/api，:3000）。
export default defineConfig({
  base: '/teacher-assets/',
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      // WS 只代理 /teacher 這個路徑本身（用 regex，避免吃掉 /teacher-assets/* 的靜態資源）
      '^/teacher($|\\?)': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
  },
});
