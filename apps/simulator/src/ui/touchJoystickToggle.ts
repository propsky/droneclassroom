// 工具列「觸控搖桿」：手動顯示或隱藏畫面上的虛擬搖桿，並記住選擇。
import { setTouchJoysticksVisible } from '../input/joystick';

export class TouchJoystickToggle {
  static init(doc: Document = document): void {
    const btn = doc.getElementById('touch-joystick-btn');
    if (!btn) return;

    const paint = (): void => {
      const on = doc.body.classList.contains('touch-joysticks');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('active', on);
      btn.title = on ? '隱藏畫面上的虛擬搖桿' : '顯示畫面上的虛擬搖桿';
    };

    btn.addEventListener('click', () => {
      const next = !doc.body.classList.contains('touch-joysticks');
      setTouchJoysticksVisible(next);
      paint();
    });
    paint();
  }
}
