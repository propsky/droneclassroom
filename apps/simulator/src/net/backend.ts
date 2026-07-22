// 後端位置設定（前後分離部署用）。
// build 時以環境變數 VITE_API_URL 指定後端網址（如 https://creafly-api.propskynet.com）；
// 留空 = 同網域（本機開發走 vite proxy、all-in-one 部署直接同源）——行為與既有完全相同。
// 之後要換後端網域：只改 Pages 專案的 VITE_API_URL 環境變數重新部署，零代碼改動。

const raw = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** 後端 HTTP 位址（'' = 同網域） */
export const API_BASE = raw;

/** 組 WebSocket 連線網址：有設 VITE_API_URL 用它（https→wss），否則同網域推導 */
export function wsUrl(path: string): string {
  if (API_BASE) return API_BASE.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
