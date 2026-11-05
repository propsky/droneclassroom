// 簡易 ↔ 真實物理：工具列切換鈕、狀態卡裡的「推力 vs 重量」儀表。
// 選擇記在 localStorage（每台平板自己的偏好）。真實物理在一般關卡與足球生效，大亂鬥固定簡易。
import { droneState, flags, realFlight } from '../core/droneState';
import { bus, toast } from '../core/events';
import { realPhysicsOn, setFlightPhysics } from '../core/physics';
import { RealFlight } from '../core/realFlight';
import { GameSession } from '../core/session';
import { iconHtml } from './icons';
import { PhysicsReadout } from './physicsReadout';
import type { FlightPhysics } from '@creafly/shared';

const LS_PHYSICS = 'creafly_flight_physics';

function readSaved(): FlightPhysics {
  try {
    return localStorage.getItem(LS_PHYSICS) === 'real' ? 'real' : 'arcade';
  } catch {
    return 'arcade';
  }
}

function save(mode: FlightPhysics): void {
  try {
    localStorage.setItem(LS_PHYSICS, mode);
  } catch {
    /* 私密視窗：只在這次有效 */
  }
}

const $ = (id: string): HTMLElement | null => document.getElementById(id);

/** 狀態卡底部的儀表（第一次需要時才建，簡易物理的人看不到） */
function buildGauge(): HTMLElement | null {
  const card = $('status-hud');
  if (!card) return null;
  const el = document.createElement('div');
  el.id = 'physics-live';
  el.className = 'physics-live';
  el.hidden = true;
  el.setAttribute('aria-label', '真實物理');
  el.innerHTML = `
    <div class="physics-head" title="上升／下降是加減油門，放開會保持；50% 剛好懸停">
      <span class="label">油門</span><span class="value mono" id="phys-throttle">0%</span>
    </div>
    <div class="physics-bar" aria-hidden="true">
      <div class="physics-fill" id="phys-fill"></div>
      <div class="physics-hover" id="phys-hover"><span>懸停</span></div>
    </div>
    <div class="physics-grid">
      <div class="row" title="推力是重量的幾倍"><span class="label">推力</span><span class="value mono" id="phys-thrust">0.00 × 重量</span></div>
      <div class="row" title="機身傾斜，推力才有往前的分量"><span class="label">傾角</span><span class="value mono" id="phys-tilt">0°</span></div>
      <div class="row wide" title="推力往上的分量減掉重力"><span class="label">上下合力</span><span class="value mono" id="phys-net">力平衡</span></div>
    </div>`;
  card.appendChild(el);
  return el;
}

let gauge: HTMLElement | null = null;
const cache = { throttle: '', thrust: '', net: '', balance: '', tilt: '', fill: -1 };

/** 每畫面：真實物理且手動飛行時更新儀表 */
export function updatePhysicsHud(): void {
  const show = realPhysicsOn() && flags.mode === 'manual' && !droneState.returning;
  if (!show) {
    if (gauge && !gauge.hidden) gauge.hidden = true;
    return;
  }
  gauge ??= buildGauge();
  if (!gauge) return;
  if (gauge.hidden) gauge.hidden = false;
  const v = PhysicsReadout.of({
    throttle: realFlight.throttle,
    thrustRatio: realFlight.thrust * RealFlight.THRUST_TO_WEIGHT,
    netLift: RealFlight.netLift(),
    tilt: RealFlight.tilt(),
    hover: RealFlight.HOVER,
    grounded: droneState.isGrounded,
  });
  const set = (id: string, key: 'throttle' | 'thrust' | 'net' | 'tilt'): void => {
    if (cache[key] === v[key]) return;
    cache[key] = v[key];
    const el = $(id);
    if (el) el.textContent = v[key];
  };
  set('phys-throttle', 'throttle');
  set('phys-thrust', 'thrust');
  set('phys-net', 'net');
  set('phys-tilt', 'tilt');
  if (cache.fill !== v.fillPct) {
    cache.fill = v.fillPct;
    const fill = $('phys-fill');
    if (fill) fill.style.width = `${v.fillPct}%`;
    const hover = $('phys-hover');
    if (hover) hover.style.left = `${v.hoverPct}%`;
  }
  if (cache.balance !== v.balance) {
    cache.balance = v.balance;
    gauge.dataset.balance = v.balance;
  }
}

export function initFlightPhysicsUi(): void {
  const btn = $('physics-btn');
  const sync = (): void => {
    const real = flags.physics === 'real';
    document.body.classList.toggle('physics-real', real);
    if (!btn) return;
    btn.innerHTML = `${iconHtml('atom')}<span>物理：${real ? '真實' : '簡易'}</span>`;
    btn.classList.toggle('active', real);
    btn.setAttribute('aria-pressed', real ? 'true' : 'false');
  };
  bus.on('physics-changed', sync);
  setFlightPhysics(readSaved());
  sync();
  btn?.addEventListener('click', () => {
    const next: FlightPhysics = flags.physics === 'real' ? 'arcade' : 'real';
    setFlightPhysics(next);
    save(next);
    const note = GameSession.active === 'arena' ? '（大亂鬥固定用簡易物理，離開大亂鬥才生效）' : '';
    toast(
      next === 'real'
        ? `真實物理：有重力，油門要自己控制。上升／下降是加減油門，放開會保持${note}`
        : `簡易物理：放開搖桿就停在空中${note}`,
      next === 'real' ? 'warning' : 'success',
    );
  });
}
