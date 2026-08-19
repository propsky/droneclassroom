import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 開發時 WS 走 /ws 代理到本機後端（apps/api，:3000）
export default defineConfig(({ mode }) => {
  // 後端網域（與 src/net/backend.ts 同一來源）：有設時，該網域的所有請求一律走網路、不進快取。
  // generateSW 會把 runtimeCaching 序列化進 sw.js，函式不能閉包外部變數 → 這裡編成 RegExp 再交出去
  const apiOrigin = (loadEnv(mode, process.cwd()).VITE_API_URL ?? '').replace(/\/+$/, '');
  const apiOriginPattern = apiOrigin
    ? new RegExp('^' + apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/')
    : null;

  return {
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
    plugins: [
      // 離線可玩（單機模式）：Service Worker 預快取 + 大資產 runtime cache。詳見 docs/offline.md
      VitePWA({
        // 新版上線後背景靜默下載，下次開啟生效（教室不會卡在舊版，也不會上課上到一半被 reload）
        registerType: 'autoUpdate',
        // 開發模式不啟用 SW，避免快取干擾 HMR / 除錯
        devOptions: { enabled: false },
        // 由 src/pwa.ts 自己註冊（要接 toast 回饋），不用插件自動注入的腳本。
        // 注意：injectRegister 為 auto/null 時插件會強制 skipWaiting/clientsClaim=true（新 SW 立刻接管，
        // 舊頁面 lazy chunk 會失效）；設 false 才尊重下方的 skipWaiting:false
        injectRegister: false,
        manifest: {
          name: 'CREAFLY 無人機模擬器',
          short_name: 'CREAFLY',
          description: 'CREAFLY 教室版無人機模擬器 — 手動 / Blockly 程式化飛行',
          lang: 'zh-Hant',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'landscape',
          background_color: '#0B1220',
          theme_color: '#00A3E0',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          // 預快取 = 「開起來能玩單機關卡」的最小集合：
          // index.html、JS/CSS chunk、關卡 JSON、Blockly media、圖標
          // （main chunk 約 6.7MB，故放寬單檔上限；wasm/glb/hdr/mp3 排除，改走 runtime cache）
          globPatterns: [
            '**/*.{js,css,html,json,svg,png,gif,cur,ico,webmanifest}',
            'blockly-media/*.{mp3,ogg,wav}', // Blockly 點擊音效（極小）
          ],
          globIgnores: ['**/node_modules/**', 'teacher/**', 'assets/**/*.wasm'],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          // 舊版 SW 的過期快取隨新版清掉
          cleanupOutdatedCaches: true,
          // 新 SW 裝好後「等待」：目前開著的分頁繼續用舊版（lazy chunk 不會 404），全部關閉後下次開啟才切換；
          // clientsClaim 只在「啟用」當下生效：首次安裝後立刻接管本頁（runtime cache 才能開始收 HDRI 等資產）
          skipWaiting: false,
          clientsClaim: true,
          // SPA 導覽離線時回 index.html；老師後台（同 Pages 專案 /teacher/）與後端路徑不接管
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/teacher/, /^\/api\//, /^\/auth/, /^\/ws/],
          runtimeCaching: [
            // 後端 API / 登入 / 老師後台：一律不快取（同網域路徑）。
            // WebSocket 握手不經 Service Worker，/ws 天生不受影響。
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && /^\/(api|auth|teacher)(\/|$)/.test(url.pathname),
              handler: 'NetworkOnly',
            },
            // 後端 API：一律不快取（VITE_API_URL 指定的獨立網域）
            ...(apiOriginPattern ? [{ urlPattern: apiOriginPattern, handler: 'NetworkOnly' as const }] : []),
            // 大資產：用過才存（CacheFirst）。第一次仍需網路 — 見 docs/offline.md「已知限制」
            // Havok WASM（遊樂場 / 足球才 lazy 載，約 2MB）
            {
              urlPattern: /\/assets\/.*\.wasm$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'creafly-wasm',
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // 場景模型 / HDRI 環境（playground glb 5.7MB、hdr 1.7MB）
            {
              urlPattern: /\/assets\/(maps|env)\/.*\.(glb|gltf|hdr|env|dds|ktx2?|jpe?g|png|webp)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'creafly-scene-assets',
                expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // 背景音樂（13.7MB；<audio> 會發 Range 請求，開 rangeRequests 才吃得到快取）
            {
              urlPattern: /\/assets\/music\/.*\.(mp3|ogg|m4a)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'creafly-music',
                rangeRequests: true,
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
  };
});
