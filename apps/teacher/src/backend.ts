// 後端位置設定（前後分離部署用）——與 simulator 的 net/backend.ts 同一套約定。
// build 時以 VITE_API_URL 指定後端網址；留空 = 同網域（dev proxy / all-in-one）。
// 換後端網域：只改 Pages 專案的 VITE_API_URL 環境變數重新部署。

const raw = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** 後端 HTTP 位址（'' = 同網域），REST fetch 一律加此前綴 */
export const API_BASE = raw;

/** 組 WebSocket 連線網址（https→wss） */
export function wsUrl(path: string): string {
  if (API_BASE) return API_BASE.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
