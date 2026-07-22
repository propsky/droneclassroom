// 鍵盤輸入：WASD 平移、↑↓ 升降、←→ 旋轉、Space 緊急停止、C 切換視角。
import { emergencyStop } from '../core/physics';

export const keys: Record<string, boolean> = {};

let onToggleView: (() => void) | null = null;

export function initKeyboard(opts: { toggleView: () => void }): void {
  onToggleView = opts.toggleView;

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    // 方向鍵 / 空白鍵：避免捲動頁面
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === ' '
    ) {
      e.preventDefault();
    }
    // 空白鍵 = 緊急停止（空中觸發；不重複觸發）
    if (e.key === ' ' && !e.repeat) emergencyStop();
    // C = 切換視角（第三人稱 ⇄ FPV）
    if (k === 'c' && !e.repeat) onToggleView?.();
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  // 視窗失焦：清掉所有按鍵，避免卡鍵
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
  });
}
