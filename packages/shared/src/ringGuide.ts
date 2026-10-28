// 穿圈引導外觀：下一個圈、還沒輪到、已穿過。
// 只描述該怎麼畫，不改穿過判定、計分或重播。
import { RingJudge } from './completionJudge';

export type RingGuidePhase = 'next' | 'upcoming' | 'passed';

export interface RingGuideLook {
  /** null = 沿用圈自己的顏色 */
  color: number | null;
  emissive: number;
  alpha: number;
  badgeFill: string;
  badgeStroke: string;
  badgeInk: string;
  /** 編號牌相對基本尺寸的倍率 */
  badgeScale: number;
  pulse: boolean;
}

/** 所有有圈的關卡共用：標出下一個要飛的圈。 */
export class RingGuide {
  /** 依通過旗標決定這一圈現在屬於哪一種外觀。 */
  static phase(passed: readonly boolean[], index: number): RingGuidePhase {
    if (passed[index]) return 'passed';
    if (RingJudge.isNext(passed, index)) return 'next';
    return 'upcoming';
  }

  /** 飛行順序編號，從 1 起算。 */
  static label(index: number): string {
    return String(index + 1);
  }

  /**
   * 同一條直線上的圈，編號要往側面錯開（公尺）。
   * 位置本來就分開的圈回 0，編號留在自己的圈旁邊。
   */
  static lateralSpread(index: number, rings: readonly { x: number; z: number }[]): number {
    const self = rings[index];
    if (!self) return 0;
    let stacked = false;
    for (let i = 0; i < rings.length; i++) {
      if (i === index) continue;
      const other = rings[i];
      if (!other) continue;
      const dx = Math.abs(other.x - self.x);
      const dz = Math.abs(other.z - self.z);
      if (dx < 1.2 && dz > 2) stacked = true;
    }
    // 3m：近處的圈在畫面上大約佔這個寬度，後面的編號才不會被它擋住。
    return stacked ? index * 3 : 0;
  }

  /**
   * 好幾個步驟在同一個地點（例如八字交叉點、回到原點）時，那裡只顯示一個標記：
   * 還有沒做完的 → 編號最小的那個；全部做完 → 最後一個。回傳每一項要不要顯示。
   */
  static shownAtSameSpot(
    points: readonly ({ x: number; z: number } | null)[],
    done: readonly boolean[],
    spotM = 0.3,
  ): boolean[] {
    const shown = points.map(() => false);
    const grouped = points.map(() => false);
    points.forEach((p, i) => {
      if (!p || grouped[i]) return;
      const group: number[] = [];
      points.forEach((q, j) => {
        if (q && !grouped[j] && Math.abs(q.x - p.x) <= spotM && Math.abs(q.z - p.z) <= spotM) {
          group.push(j);
          grouped[j] = true;
        }
      });
      const leader = group.find((j) => !done[j]) ?? group[group.length - 1]!;
      shown[leader] = true;
    });
    return shown;
  }

  /**
   * 圈面沿線的水平方向（擺放角度 yawDeg 時，機身右方）。編號牌與編輯器的圈面線都沿這個方向。
   * yaw=0 → (+1, 0)，與 core/droneState rightVec 同一套。
   */
  static planeDir(yawDeg: number): { x: number; z: number } {
    const r = (yawDeg * Math.PI) / 180;
    return { x: Math.cos(r), z: -Math.sin(r) };
  }

  /**
   * 依飛行順序讓圈面對著路線：第 i 圈朝「前一點 → 下一點」的方向（度，取整數）。
   * 第一圈的前一點是起飛墊；最後一圈用「前一圈 → 自己」。
   * 繞圈、蛇行、八字都適用；算出來的是起點，老師可再微調。
   */
  static routeYaw(
    rings: readonly { x: number; z: number }[],
    index: number,
    start: { x: number; z: number } = { x: 0, z: 0 },
  ): number {
    const self = rings[index];
    if (!self) return 0;
    const prev = index > 0 ? rings[index - 1]! : start;
    const next = rings[index + 1] ?? self;
    let fx = next.x - prev.x;
    let fz = next.z - prev.z;
    if (Math.hypot(fx, fz) < 1e-6) {
      fx = self.x - prev.x;
      fz = self.z - prev.z;
    }
    if (Math.hypot(fx, fz) < 1e-6) return 0;
    // 機頭方向 forward = (-sinθ, -cosθ) → θ = atan2(-fx, -fz)
    const deg = Math.round((Math.atan2(-fx, -fz) * 180) / Math.PI);
    return deg === -180 ? 180 : deg + 0;
  }

  /**
   * 三種外觀要能一眼分開。
   * aligned 只作用在下一個圈：旋轉鑽圈對準機頭時改成綠色，沿用既有提示。
   */
  static look(phase: RingGuidePhase, aligned = false): RingGuideLook {
    if (phase === 'next') {
      return aligned
        ? {
            color: 0x4ade80,
            emissive: 0.8,
            alpha: 1,
            badgeFill: '#15803d',
            badgeStroke: '#f0fdf4',
            badgeInk: '#ffffff',
            badgeScale: 1.2,
            pulse: true,
          }
        : {
            color: 0xfbbf24,
            emissive: 0.95,
            alpha: 1,
            badgeFill: '#d97706',
            badgeStroke: '#fffbeb',
            badgeInk: '#ffffff',
            badgeScale: 1.2,
            pulse: true,
          };
    }
    if (phase === 'passed') {
      return {
        color: 0x64748b,
        emissive: 0.1,
        alpha: 0.38,
        badgeFill: '#1e293b',
        badgeStroke: '#64748b',
        badgeInk: '#cbd5e1',
        badgeScale: 0.78,
        pulse: false,
      };
    }
    return {
      color: null,
      emissive: 0.35,
      alpha: 0.72,
      badgeFill: '#0f172a',
      badgeStroke: '#94a3b8',
      badgeInk: '#e2e8f0',
      badgeScale: 0.92,
      pulse: false,
    };
  }
}
