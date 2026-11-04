// 撞擊速度浮字：撞牆、撞障礙、落地夠快時，畫面中間跳「撞擊 3.2 m/s」，1.6 秒淡出。
// 只聽 core 的 'impact' 事件，不碰物理。
import { bus } from '../core/events';
import { ImpactText } from './impactLabel';

const SHOW_MS = 1600;

export function initImpactPopup(): void {
  const host = document.getElementById('scene-overlay');
  if (!host) return;
  const el = document.createElement('div');
  el.id = 'impact-pop';
  el.className = 'impact-pop';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  host.appendChild(el);
  let timer: ReturnType<typeof setTimeout> | null = null;
  bus.on('impact', ({ speed, surface }) => {
    const label = ImpactText.of(speed, surface);
    el.textContent = label.text;
    el.className = `impact-pop tone-${label.tone}`;
    // 重新觸發動畫：先拿掉 show、強制排版、再加回
    void el.offsetWidth;
    el.classList.add('show');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), SHOW_MS);
  });
}
