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
   * 照飛行順序前後接連排成一列、從這個圈看得到前面圈的洞（1-4 直線穿圈）時，
   * 編號要往側面錯開（公尺），不然遠處的編號會疊在近處的洞裡。錯開量＝往前數有幾個圈連續排在同一列。
   * 位置岔開、或只是剛好落在同一條線上但不是接連飛的圈（例如 8 字的 1 和 4）回 0，編號留在自己的圈旁邊。
   */
  static lateralSpread(index: number, rings: readonly { x: number; z: number; yawDeg?: number }[]): number {
    const self = rings[index];
    if (!self) return 0;
    // 圈面法線（穿越方向）：和機頭 forward 同一套 (-sinθ, -cosθ)
    const normal = (r: { yawDeg?: number }): [number, number] => {
      const yaw = ((r.yawDeg ?? 0) * Math.PI) / 180;
      return [-Math.sin(yaw), -Math.cos(yaw)];
    };
    // 另一個圈在這個圈的穿越方向上（偏離中線 < 1.2m、前後相隔 > 2m）
    const inLine = (n: [number, number], dx: number, dz: number): boolean =>
      Math.abs(dx * n[1] - dz * n[0]) < 1.2 && Math.abs(dx * n[0] + dz * n[1]) > 2;
    let run = 0;
    for (let i = index - 1; i >= 0; i--) {
      const other = rings[i];
      if (!other) break;
      const dx = other.x - self.x;
      const dz = other.z - self.z;
      // 兩個圈都要面向這條線，才會隔著洞看到對方的編號
      if (!inLine(normal(self), dx, dz) || !inLine(normal(other), dx, dz)) break;
      run++;
    }
    // 3m：近處的圈在畫面上大約佔這個寬度，後面的編號才不會被它擋住。
    return run * 3;
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
   * 編號牌放在圈的哪一側：沿圈面，朝整條路線中心的反方向（放在路線外側，不擋穿越路線、
   * 也不會和對面圈的編號擠在中間）。在中心線上分不出內外的（直線穿圈）維持 planeDir 原方向。
   */
  static badgeDir(index: number, rings: readonly { x: number; z: number; yawDeg?: number }[]): { x: number; z: number } {
    const self = rings[index];
    if (!self) return { x: 1, z: 0 };
    const dir = RingGuide.planeDir(self.yawDeg ?? 0);
    const cx = rings.reduce((sum, r) => sum + r.x, 0) / rings.length;
    const cz = rings.reduce((sum, r) => sum + r.z, 0) / rings.length;
    const outward = (self.x - cx) * dir.x + (self.z - cz) * dir.z;
    return outward < -1e-6 ? { x: -dir.x, z: -dir.z } : dir;
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
