// 模擬核心版本：建置時由 scripts/simVersion.mjs 對 core/ + shared/ + 官方關卡內容雜湊注入。
// 前端（vite）與伺服器驗證器（esbuild）以同一函式計算 → 同一 commit 必相同；
// 不同 = 前後端尚未同步部署，伺服器判為「無法驗證」而非可疑。未注入（vitest / tsx）= 'dev'。
declare const __CREAFLY_SIM_VERSION__: string | undefined;

export const SIM_VERSION: string =
  typeof __CREAFLY_SIM_VERSION__ === 'string' ? __CREAFLY_SIM_VERSION__ : 'dev';
