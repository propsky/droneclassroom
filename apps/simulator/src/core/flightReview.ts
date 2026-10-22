// 本趟飛行回顧：空中時間、路徑長、最高速度、最高高度。
// 每個固定 60Hz tick 餵一次「該 tick 結束後」的 droneState 樣本。
// 不讀 performance.now() / Date，因此同一段輸入在重播時數字相同。
// 純累加、不寫回無人機狀態，也不進 ControlFrame、inputRecording、replayHash。
// 模擬器沒有電池電流、mAh 或 G 力，這裡不推估那些量。
import { detHypot3 } from '@creafly/shared';

/** 與 droneState.TICK_HZ 相同。不從那裡 import，避免 reset 路徑循環依賴。 */
const TICK_HZ = 60;

export interface FlightReviewSample {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  isFlying: boolean;
}

export interface FlightReviewStats {
  /** 空中經過的固定 tick 數（落地後那個 tick 不算） */
  airTicks: number;
  /** 路徑長（公尺）。含起飛與落地那一段，不含地面滑行。 */
  distanceM: number;
  /** 最高速度（公尺／秒）= 該 tick 結束時 |velocity| × 60 */
  topSpeedMps: number;
  /** 最高高度（公尺，position.y；僅空中樣本） */
  maxAltitudeM: number;
}

export interface FlightReviewLine {
  label: string;
  value: string;
}

/**
 * 固定時步累加器。呼叫端每個關卡 tick 呼叫一次 tick()；
 * 重播走同一條 tickLevelSimulation，所以同一份輸入得到同一組數字。
 */
export class FlightReview {
  static readonly TICK_HZ = TICK_HZ;

  static #airTicks = 0;
  static #distanceM = 0;
  static #topSpeedMps = 0;
  static #maxAltitudeM = 0;
  static #hasPrev = false;
  static #prevFlying = false;
  static #px = 0;
  static #py = 0;
  static #pz = 0;

  static reset(): void {
    this.#airTicks = 0;
    this.#distanceM = 0;
    this.#topSpeedMps = 0;
    this.#maxAltitudeM = 0;
    this.#hasPrev = false;
    this.#prevFlying = false;
    this.#px = this.#py = this.#pz = 0;
  }

  /** 吃 tick 結束後的狀態。位置會複本，不握住 droneState 的參照。 */
  static tick(sample: FlightReviewSample): void {
    const x = sample.position.x;
    const y = sample.position.y;
    const z = sample.position.z;
    const flying = sample.isFlying;
    if (this.#hasPrev && (this.#prevFlying || flying)) {
      this.#distanceM += detHypot3(x - this.#px, y - this.#py, z - this.#pz);
    }
    if (flying) {
      this.#airTicks += 1;
      const speed = detHypot3(sample.velocity.x, sample.velocity.y, sample.velocity.z) * TICK_HZ;
      if (speed > this.#topSpeedMps) this.#topSpeedMps = speed;
      if (y > this.#maxAltitudeM) this.#maxAltitudeM = y;
    }
    this.#px = x;
    this.#py = y;
    this.#pz = z;
    this.#prevFlying = flying;
    this.#hasPrev = true;
  }

  static snapshot(): FlightReviewStats {
    return {
      airTicks: this.#airTicks,
      distanceM: this.#distanceM,
      topSpeedMps: this.#topSpeedMps,
      maxAltitudeM: this.#maxAltitudeM,
    };
  }

  /** 給 HUD / 結算卡的四列。未滿 60 秒顯示到小數一位，之後為分:秒。 */
  static lines(stats: FlightReviewStats): FlightReviewLine[] {
    return [
      { label: '空中時間', value: formatAirtime(stats.airTicks) },
      { label: '飛行距離', value: `${stats.distanceM.toFixed(1)} m` },
      { label: '最高速度', value: `${stats.topSpeedMps.toFixed(1)} m/s` },
      { label: '最高高度', value: `${stats.maxAltitudeM.toFixed(1)} m` },
    ];
  }
}

function formatAirtime(airTicks: number): string {
  if (airTicks < TICK_HZ * 60) return `${(airTicks / TICK_HZ).toFixed(1)} 秒`;
  const total = Math.floor(airTicks / TICK_HZ);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
