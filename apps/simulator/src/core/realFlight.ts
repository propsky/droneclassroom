// 真實物理（重力＋油門）：一般關卡的選配模式，給國高中講力的平衡、F = ma、慣性。
// 簡易物理（physics.ts 的 applyManualControls / integrate）一行都不動，舊關卡、舊錄製照舊。
//
// 每 tick（半隱式 Euler；加速度用 m/s²，速度沿用 droneState 的「每 tick 公尺」）：
//   油門：左桿推上／下是「加／減油門」，放開就停在那裡。彈簧搖桿和鍵盤都能維持一個油門，
//         經過懸停點（推力 = 重量）會卡 0.25 秒，比較找得到。
//   推力：實際推力追油門，約 0.06 秒（馬達加速）；滿油門 = 2 倍重量。
//   傾角：右桿命令傾角，最多 25°，約 0.12 秒追上；放開自己回平（自穩模式）。
//         推力跟著機身傾斜：往前的分量讓它走，往上的分量變少，前進時要多給一點油門。
//   阻力：一次項（槳盤阻力）＋二次項（空氣阻力）。不推桿會慢慢滑停，不會馬上煞住。
//   地面：推力撐不起重量就待在地上。
// 參數讓任何方向的極速都低於簡易物理（約 8.0 < 8.3 m/s），切換物理不會讓排行榜變快。
// 只用四則運算、sqrt 與 detSin / detCos：跨引擎 bit 一致（G-04），伺服器重播算得出同一條軌跡。
import { detCos, detSin } from '@creafly/shared';
import { droneState, realFlight, forwardVec, rightVec, resetRealFlight, TICK_HZ } from './droneState';
import type { ControlFrame } from './physics';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class RealFlight {
  /** 重力加速度（m/s²，地球標準重力） */
  static readonly G = 9.80665;
  /** 滿油門推力是重量的幾倍 */
  static readonly THRUST_TO_WEIGHT = 2;
  /** 懸停油門（推力剛好等於重量） */
  static readonly HOVER = 1 / RealFlight.THRUST_TO_WEIGHT;
  /** 滿桿每 tick 加減的油門：1.5 秒從 0 到 100% */
  static readonly THROTTLE_PER_TICK = 1 / 90;
  /** 經過懸停點時卡住的 tick 數 */
  static readonly DETENT_TICKS = 15;
  /** 起飛鍵直接給的油門：比懸停多一點，慢慢升起 */
  static readonly TAKEOFF_THROTTLE = 0.6;
  /** 最大傾角（弧度，25°） */
  static readonly MAX_TILT = (25 * Math.PI) / 180;
  /** 傾角每 tick 追目標的比例 = 1 − e^(−(1/60)/0.12)，時間常數 0.12 秒 */
  static readonly ATTITUDE_GAIN = 0.13;
  /** 推力每 tick 追油門的比例 = 1 − e^(−(1/60)/0.06)，時間常數 0.06 秒 */
  static readonly MOTOR_GAIN = 0.24;
  /** 一次阻力（1/s） */
  static readonly DRAG_LINEAR = 0.4;
  /** 二次阻力（1/m） */
  static readonly DRAG_QUAD = 0.08;

  private static readonly DT = 1 / TICK_HZ;

  /** 一進真實物理：在空中就從懸停接手（不會一切換就掉下去），在地上油門歸零 */
  static enter(): void {
    if (droneState.isFlying && !droneState.returning) RealFlight.hover();
    else resetRealFlight();
  }

  /** 油門、推力停在懸停，機身擺平（急停解除、空中切進真實物理） */
  static hover(): void {
    realFlight.throttle = RealFlight.HOVER;
    realFlight.thrust = RealFlight.HOVER;
    realFlight.pitch = 0;
    realFlight.roll = 0;
    realFlight.detent = 0;
  }

  /** 起飛鍵：在地上把油門推到起飛油門（推力上來就會自己離地） */
  static takeoff(): void {
    if (realFlight.throttle < RealFlight.TAKEOFF_THROTTLE) realFlight.throttle = RealFlight.TAKEOFF_THROTTLE;
    realFlight.detent = 0;
  }

  /**
   * 一個 tick 的操控：油門、傾角、馬達、機頭。
   * frame 為 null = 手動被鎖（倒數等）：油門不動、傾角回平。
   */
  static control(frame: ControlFrame | null): void {
    const r = realFlight;
    const flying = droneState.isFlying;
    if (frame) {
      const lift = clamp(frame.lift, -1, 1);
      if (lift === 0) r.detent = 0;
      else if (r.detent > 0) r.detent--;
      else {
        const prev = r.throttle;
        let next = clamp(prev + lift * RealFlight.THROTTLE_PER_TICK, 0, 1);
        const h = RealFlight.HOVER;
        if ((prev < h && next >= h) || (prev > h && next <= h)) {
          next = h;
          r.detent = RealFlight.DETENT_TICKS;
        }
        r.throttle = next;
      }
      if (flying && frame.yawDelta !== 0) droneState.yaw += frame.yawDelta;
    }
    let tp = 0;
    let tr = 0;
    if (frame && flying) {
      const max = RealFlight.MAX_TILT;
      tp = clamp(frame.forward, -1, 1) * max;
      tr = clamp(frame.right, -1, 1) * max;
      const m = Math.sqrt(tp * tp + tr * tr);
      if (m > max) {
        tp *= max / m;
        tr *= max / m;
      }
    }
    if (flying) {
      r.pitch += (tp - r.pitch) * RealFlight.ATTITUDE_GAIN;
      r.roll += (tr - r.roll) * RealFlight.ATTITUDE_GAIN;
    } else {
      r.pitch = 0;
      r.roll = 0;
    }
    r.thrust += (r.throttle - r.thrust) * RealFlight.MOTOR_GAIN;
    droneState.attitudePitch = r.pitch;
    droneState.attitudeRoll = r.roll;
  }

  /** 機身傾角（弧度） */
  static tilt(): number {
    return Math.sqrt(realFlight.pitch * realFlight.pitch + realFlight.roll * realFlight.roll);
  }

  /** 推力（m/s²，等於每公斤受的力） */
  static thrustAccel(): number {
    return realFlight.thrust * RealFlight.THRUST_TO_WEIGHT * RealFlight.G;
  }

  /** 推力往上的分量減掉重力（m/s²）：正 = 往上加速，0 = 力平衡 */
  static netLift(): number {
    return RealFlight.thrustAccel() * detCos(RealFlight.tilt()) - RealFlight.G;
  }

  /**
   * 合力改速度（不動位置）。在地上推力撐不起重量就不動；撐得起就離地。
   * 回傳 false = 還在地上，這 tick 不用積分位置。
   */
  static accelerate(): boolean {
    const v = droneState.velocity;
    const r = realFlight;
    const up = RealFlight.netLift();
    if (droneState.isGrounded) {
      if (up <= 0) {
        v.x = v.y = v.z = 0;
        return false;
      }
      droneState.isGrounded = false;
      droneState.isFlying = true;
    }
    const tilt = RealFlight.tilt();
    let ax = 0;
    let az = 0;
    if (tilt > 1e-9) {
      const side = RealFlight.thrustAccel() * detSin(tilt);
      const fwd = (side * r.pitch) / tilt;
      const rgt = (side * r.roll) / tilt;
      const f = forwardVec(droneState.yaw);
      const rv = rightVec(droneState.yaw);
      ax = f.x * fwd + rv.x * rgt;
      az = f.z * fwd + rv.z * rgt;
    }
    // 速度是每 tick 公尺：dv = a·dt²；阻力 k·v_si·dt² = k·v·dt
    const dt = RealFlight.DT;
    const dt2 = dt * dt;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * TICK_HZ;
    const kdt = (RealFlight.DRAG_LINEAR + RealFlight.DRAG_QUAD * speed) * dt;
    v.x += ax * dt2 - kdt * v.x;
    v.y += up * dt2 - kdt * v.y;
    v.z += az * dt2 - kdt * v.z;
    return true;
  }
}
