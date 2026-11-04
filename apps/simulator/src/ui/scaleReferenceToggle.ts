// 工具列「比例尺」：開關 render/scaleReference.ts 的格線、距離標籤與課桌椅。預設關，記在 localStorage。
import { toast } from '../core/events';
import { iconHtml } from './icons';

const LS_SCALE_REF = 'creafly_scale_ref';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(LS_SCALE_REF) === '1';
  } catch {
    return false;
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(LS_SCALE_REF, on ? '1' : '0');
  } catch {
    /* 私密視窗：只在這次有效 */
  }
}

/**
 * apply：開關比例尺，回傳現在畫面上看不看得到（足球／大亂鬥中看不到）。
 * realScale：這一關的機身是不是實際大小（render/courseScale，由 main 接上）。
 */
export function initScaleReferenceToggle(apply: (on: boolean) => boolean, realScale: () => boolean): void {
  let enabled = readEnabled();
  const btn = document.getElementById('scale-ref-btn');
  const sync = (): void => {
    if (!btn) return;
    btn.innerHTML = `${iconHtml('ruler')}<span>比例尺：${enabled ? '開' : '關'}</span>`;
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  };
  sync();
  apply(enabled);
  btn?.addEventListener('click', () => {
    enabled = !enabled;
    writeEnabled(enabled);
    sync();
    const shown = apply(enabled);
    if (!enabled) {
      toast('比例尺關閉');
    } else if (!shown) {
      toast('比例尺開啟：回到關卡後顯示');
    } else if (realScale()) {
      toast('比例尺開啟：每格 1 公尺，課桌和無人機都是實際大小');
    } else {
      // 卡通機身含螺旋槳約 4.6 m 寬，跟課桌放在一起會很誇張，先講清楚
      toast('比例尺開啟：每格 1 公尺（這一關的無人機畫得比實際大，真實比例關卡才是實際大小）');
    }
  });
}
