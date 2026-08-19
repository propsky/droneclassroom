// 效能驗收後門：?fps=1 → 右下角極簡小字，每秒更新一次 fps（實機驗收 16 機 ≥50fps 用，見 docs/perf-arena.md）。
// 純 DOM、不引 Babylon：fps 由 main.ts 以 getter 注入（engine.getFps() 是渲染層的事）。
// 沒帶 ?fps=1 時不建任何 DOM、不起計時器 → 對正常使用零成本。

export function initFpsMeter(getFps: () => number): void {
  if (new URLSearchParams(location.search).get('fps') !== '1') return;
  const el = document.createElement('div');
  el.id = 'fps-meter';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    right: '8px',
    bottom: '4px',
    zIndex: '9999',
    font: '600 11px/1.2 ui-monospace, Menlo, monospace',
    color: '#fff',
    background: 'rgba(10,37,64,0.72)',
    padding: '2px 6px',
    borderRadius: '6px',
    pointerEvents: 'none',
    opacity: '0.85',
  } satisfies Partial<CSSStyleDeclaration>);
  el.textContent = 'fps --';
  document.body.appendChild(el);
  // 每秒一次：engine.getFps() 本身就是滑動平均，秒級更新足夠、不干擾主迴圈
  setInterval(() => {
    el.textContent = `fps ${Math.round(getFps())}`;
  }, 1000);
}
