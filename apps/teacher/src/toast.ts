// Toast 通知 — 右上角浮出，2.5 秒自動消失。
export type ToastKind = 'info' | 'success' | 'error';

export function toast(text: string, kind: ToastKind = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
