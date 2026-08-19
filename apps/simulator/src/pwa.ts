// 離線可玩（單機模式）：註冊 Service Worker（由 vite-plugin-pwa 於 build 時產生 /sw.js）。
// - 只在正式 build 註冊（dev 不啟用，避免快取干擾）
// - 新版上線：SW 在背景下載新版並「等待」，目前分頁繼續用舊版；全部關閉後下次開啟才切換
//   （不強制 reload —— 上課上到一半不會被打斷；skipWaiting/clientsClaim 都關，見 vite.config.ts）
// - 覆蓋範圍 / 已知限制見 docs/offline.md
import { toast } from './core/events';

export function initPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // 等主資源載完再註冊，別跟首屏搶頻寬
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // 首次安裝完成（此時沒有舊 SW 在控制頁面）→ 之後可離線開啟
        // 有舊 SW 時安裝完成 = 新版已下載好，正在等待 → 提示下次開啟生效
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state !== 'installed') return;
            if (navigator.serviceWorker.controller) {
              toast('已下載最新版本，下次開啟自動更新');
            } else {
              toast('已可離線使用（單機模式）');
            }
          });
        });
      })
      .catch((e) => console.warn('[pwa] Service Worker 註冊失敗：', e));
  });
}
