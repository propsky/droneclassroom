import { describe, expect, it } from 'vitest';
import {
  AltitudeJudge,
  CROSS_TRACK_TOLERANCE_M,
  CRUISE_ALTITUDE_MAX_M,
  CRUISE_ALTITUDE_MIN_M,
  DISTANCE_TOLERANCE_M,
  DistanceJudge,
  FACE_YAW_TOLERANCE_DEG,
  FaceYawJudge,
  HEADING_TOLERANCE_DEG,
  HeadingJudge,
  LEGACY_HEADING_TOLERANCE_DEG,
  LandingJudge,
  OrderJudge,
  PassZoneJudge,
  PositionJudge,
  RETURN_PAD_RADIUS_M,
  RingJudge,
  RingPassJudge,
  RING_MAX_STEP_M,
  TaskJudge,
  YawAccumulator,
  type Pose,
} from './completionJudge';
import type { HeadingZone, PassZoneDef } from './levels';

const TOL = HEADING_TOLERANCE_DEG;

function pose(partial: Partial<Pose> = {}): Pose {
  return {
    x: 0,
    y: 0,
    z: 0,
    accumulatedYawDeg: 0,
    previousYawDeg: 0,
    grounded: false,
    ...partial,
  };
}

describe('YawAccumulator', () => {
  it('多個小增量跨過 ±180 仍保持未折疊的有號總和', () => {
    // 170 + 20 + 20 + 20 = 230。若每步折回 [-180, 180] 會變成 -130。
    const total = YawAccumulator.sum([170, 20, 20, 20]);
    expect(total).toBe(230);
    expect(HeadingJudge.matches(total, 230, TOL)).toBe(true);
    expect(HeadingJudge.matches(total, 90, TOL)).toBe(false);
    expect(HeadingJudge.matches(-130, 230, TOL)).toBe(false);
  });

  it('連續 +10° 累到 450°，不會被看成 90°', () => {
    const steps = Array.from({ length: 45 }, () => 10);
    expect(YawAccumulator.sum(steps)).toBe(450);
    expect(HeadingJudge.matches(YawAccumulator.sum(steps), 90, TOL)).toBe(false);
  });
});

describe('HeadingJudge 累積轉角', () => {
  it('剛好 90° 通過', () => {
    expect(HeadingJudge.matches(90, 90, TOL)).toBe(true);
    expect(HeadingJudge.achieved(90, 90, 90, TOL)).toBe(true);
  });

  it('容差內（含邊界）通過', () => {
    expect(HeadingJudge.matches(80, 90, TOL)).toBe(true);
    expect(HeadingJudge.matches(100, 90, TOL)).toBe(true);
    expect(HeadingJudge.achieved(100, 100, 90, TOL)).toBe(true);
  });

  it('剛超出容差不通過', () => {
    expect(HeadingJudge.matches(79.9, 90, TOL)).toBe(false);
    expect(HeadingJudge.matches(100.1, 90, TOL)).toBe(false);
    expect(HeadingJudge.achieved(100.1, 100.1, 90, TOL)).toBe(false);
  });

  it('90° 任務：轉滿 360° 不通過', () => {
    expect(HeadingJudge.matches(360, 90, TOL)).toBe(false);
    expect(HeadingJudge.achieved(360, 360, 90, TOL)).toBe(false);
  });

  it('90° 任務：轉到 450°（朝向看起來像 90°）不通過', () => {
    expect(HeadingJudge.matches(450, 90, TOL)).toBe(false);
    expect(HeadingJudge.achieved(450, 450, 90, TOL)).toBe(false);
  });

  it('轉反方向不通過', () => {
    expect(HeadingJudge.matches(-90, 90, TOL)).toBe(false);
    expect(HeadingJudge.achieved(-90, -90, 90, TOL)).toBe(false);
  });

  it('掃過目標角（這一 tick 還在轉）不算停住', () => {
    expect(HeadingJudge.achieved(90, 75, 90, TOL)).toBe(false);
    expect(HeadingJudge.isSettled(15)).toBe(false);
    expect(HeadingJudge.isSettled(0)).toBe(true);
  });

  it('facing 模式才把 450° 看成朝向 90°', () => {
    expect(HeadingJudge.matches(450, 90, TOL, 'facing')).toBe(true);
    expect(HeadingJudge.matches(360, 90, TOL, 'facing')).toBe(false);
    expect(HeadingJudge.achieved(450, 450, 90, TOL, 'facing')).toBe(true);
  });
});

describe('距離、高度、降落、順序', () => {
  it('距離容差含邊界、剛超出不算', () => {
    expect(DistanceJudge.withinTolerance(3, 3, DISTANCE_TOLERANCE_M)).toBe(true);
    expect(DistanceJudge.withinTolerance(3.5, 3, DISTANCE_TOLERANCE_M)).toBe(true);
    expect(DistanceJudge.withinTolerance(2.5, 3, DISTANCE_TOLERANCE_M)).toBe(true);
    expect(DistanceJudge.withinTolerance(3.51, 3, DISTANCE_TOLERANCE_M)).toBe(false);
    expect(DistanceJudge.withinTolerance(2.49, 3, DISTANCE_TOLERANCE_M)).toBe(false);
  });

  it('位置方框：前 3m ±0.5、橫向 ±0.8、高度帶', () => {
    const box = {
      minX: -CROSS_TRACK_TOLERANCE_M,
      maxX: CROSS_TRACK_TOLERANCE_M,
      minZ: -(3 + DISTANCE_TOLERANCE_M),
      maxZ: -(3 - DISTANCE_TOLERANCE_M),
      minY: CRUISE_ALTITUDE_MIN_M,
      maxY: CRUISE_ALTITUDE_MAX_M,
    };
    expect(PositionJudge.within({ x: 0, y: 2, z: -3 }, box)).toBe(true);
    expect(PositionJudge.within({ x: 0, y: 2, z: -2.5 }, box)).toBe(true);
    expect(PositionJudge.within({ x: 0, y: 2, z: -2.49 }, box)).toBe(false);
    expect(PositionJudge.within({ x: 0, y: 2, z: -3.51 }, box)).toBe(false);
    expect(PositionJudge.within({ x: 0.81, y: 2, z: -3 }, box)).toBe(false);
    expect(PositionJudge.within({ x: 0, y: 1.19, z: -3 }, box)).toBe(false);
    expect(PositionJudge.within({ x: 0, y: 3.01, z: -3 }, box)).toBe(false);
  });

  it('高度區間含邊界', () => {
    expect(AltitudeJudge.within(2.8, 2.8, 3.5)).toBe(true);
    expect(AltitudeJudge.within(3.5, 2.8, 3.5)).toBe(true);
    expect(AltitudeJudge.within(2.79, 2.8, 3.5)).toBe(false);
    expect(AltitudeJudge.within(3.51, 2.8, 3.5)).toBe(false);
    expect(AltitudeJudge.within(0.5, undefined, 0.5)).toBe(true);
    expect(AltitudeJudge.within(0.51, undefined, 0.5)).toBe(false);
  });

  it('落地高度與返航著地', () => {
    expect(LandingJudge.atOrBelow(0.5, 0.5)).toBe(true);
    expect(LandingJudge.atOrBelow(0.51, 0.5)).toBe(false);
    expect(LandingJudge.onPad(0, 0, true)).toBe(true);
    expect(LandingJudge.onPad(0, 0, false)).toBe(false);
    expect(LandingJudge.onPad(RETURN_PAD_RADIUS_M - 0.01, 0, true)).toBe(true);
    expect(LandingJudge.onPad(RETURN_PAD_RADIUS_M, 0, true)).toBe(false);
    expect(LandingJudge.onPad(2, 0, true)).toBe(false);
  });

  it('順序：前一步没完成就不能做下一步', () => {
    expect(OrderJudge.isActive([false, false], 0)).toBe(true);
    expect(OrderJudge.isActive([false, false], 1)).toBe(false);
    expect(OrderJudge.isActive([true, false], 1)).toBe(true);
    expect(OrderJudge.isActive([true, true], 1)).toBe(false);
    expect(RingJudge.isNext([false, false, false], 1)).toBe(false);
    expect(RingJudge.isNext([true, false, false], 1)).toBe(true);
  });

  it('鑽圈朝向用最短角差：多轉一圈後對準仍算對準', () => {
    expect(FaceYawJudge.aligned(90, 90, FACE_YAW_TOLERANCE_DEG)).toBe(true);
    expect(FaceYawJudge.aligned(450, 90, 40)).toBe(true);
    expect(FaceYawJudge.aligned(90 + 41, 90, 40)).toBe(false);
    expect(FaceYawJudge.tolerance(undefined)).toBe(FACE_YAW_TOLERANCE_DEG);
  });
});

describe('PassZoneJudge', () => {
  const heading = (target: number, mode: 'accumulated' | 'facing' = 'accumulated'): HeadingZone => ({
    type: 'heading',
    x: 0,
    z: 0,
    label: '轉角',
    targetYaw: target,
    tolerance: TOL,
    yawMode: mode,
  });

  it('90° 累積角：停住才過，360° / 450° / 反方向不過', () => {
    const zone = heading(90);
    expect(PassZoneJudge.satisfies(zone, pose({ accumulatedYawDeg: 90, previousYawDeg: 90 }))).toBe(true);
    expect(PassZoneJudge.satisfies(zone, pose({ accumulatedYawDeg: 90, previousYawDeg: 75 }))).toBe(false);
    expect(PassZoneJudge.satisfies(zone, pose({ accumulatedYawDeg: 360, previousYawDeg: 360 }))).toBe(false);
    expect(PassZoneJudge.satisfies(zone, pose({ accumulatedYawDeg: 450, previousYawDeg: 450 }))).toBe(false);
    expect(PassZoneJudge.satisfies(zone, pose({ accumulatedYawDeg: -90, previousYawDeg: -90 }))).toBe(false);
  });

  it('水平觸發半徑外不算落地', () => {
    const zone: PassZoneDef = {
      type: 'altitude',
      x: 0,
      z: -7,
      label: '降落',
      maxY: 0.5,
      triggerRadius: 1.5,
    };
    expect(PassZoneJudge.satisfies(zone, pose({ x: 0, y: 0.4, z: -7 }))).toBe(true);
    expect(PassZoneJudge.satisfies(zone, pose({ x: 0, y: 0.4, z: 0 }))).toBe(false);
  });
});

describe('老師自建的舊關卡（沒寫 yawMode / ringOrder）照原本的判定', () => {
  const legacy = (target: number, tolerance?: number): HeadingZone =>
    ({ type: 'heading', x: 0, z: 0, label: '轉角', targetYaw: target, tolerance }) as HeadingZone;

  it('沒寫 yawMode：比機頭朝向，轉一整圈回到 0° 也算', () => {
    expect(HeadingJudge.modeOf(legacy(0, 15))).toBe('facing');
    const settled = (deg: number): Pose => pose({ accumulatedYawDeg: deg, previousYawDeg: deg });
    expect(PassZoneJudge.satisfies(legacy(0, 15), settled(360))).toBe(true);
    expect(PassZoneJudge.satisfies(legacy(270, 15), settled(-90))).toBe(true);
    // 明確寫 accumulated 的新關卡照新判定
    expect(PassZoneJudge.satisfies({ ...legacy(0, 15), yawMode: 'accumulated' }, settled(360))).toBe(false);
  });

  it('沒寫 yawMode 且容差沒填或填 0：沿用當時的 20°', () => {
    expect(HeadingJudge.toleranceOf(legacy(90))).toBe(LEGACY_HEADING_TOLERANCE_DEG);
    expect(HeadingJudge.toleranceOf(legacy(90, 0))).toBe(LEGACY_HEADING_TOLERANCE_DEG);
    expect(HeadingJudge.toleranceOf(legacy(90, 12))).toBe(12);
    expect(HeadingJudge.toleranceOf({ ...legacy(90), yawMode: 'accumulated' })).toBe(HEADING_TOLERANCE_DEG);
  });

  it('沒寫 ringOrder：任意順序都算；sequential 才要照順序', () => {
    const passed = [false, false, false];
    expect(RingJudge.canPass(passed, 2, undefined)).toBe(true);
    expect(RingJudge.canPass(passed, 2, 'sequential')).toBe(false);
    expect(RingJudge.canPass(passed, 0, 'sequential')).toBe(true);
    expect(RingJudge.canPass([true, false, false], 0, undefined)).toBe(false);
  });
});

describe('TaskJudge 整關過關', () => {
  const t = (done: number, total: number) => ({ done, total });

  it('只有一種任務：做完就過關（官方關卡都是這種）', () => {
    expect(TaskJudge.allDone([t(3, 3), t(0, 0), t(0, 0)])).toBe(true);
    expect(TaskJudge.allDone([t(0, 0), t(3, 4), t(0, 0)])).toBe(false);
  });

  it('圈＋任務點混合：兩種都要做完，只做完一種不算', () => {
    expect(TaskJudge.allDone([t(2, 2), t(1, 2), t(0, 0)])).toBe(false);
    expect(TaskJudge.allDone([t(1, 2), t(2, 2), t(0, 0)])).toBe(false);
    expect(TaskJudge.allDone([t(2, 2), t(2, 2), t(0, 0)])).toBe(true);
  });

  it('一種任務都沒有（自由畫布）：不會自動過關', () => {
    expect(TaskJudge.allDone([t(0, 0), t(0, 0), t(0, 0)])).toBe(false);
    expect(TaskJudge.allDone([])).toBe(false);
  });
});

describe('RingPassJudge 穿圈要從圈裡穿過去', () => {
  const c = { x: 0, y: 2, z: -5 };
  const R = 1.5;
  const at = (x: number, y: number, z: number) => ({ x, y, z });

  it('正面穿過圈心：算；倒著穿回來也算', () => {
    expect(RingPassJudge.crossed(at(0, 2, -4.9), at(0, 2, -5.1), c, 0, R)).toBe(true);
    expect(RingPassJudge.crossed(at(0, 2, -5.1), at(0, 2, -4.9), c, 0, R)).toBe(true);
  });

  it('飛到圈前面停住、在圈前晃：不算（舊判定在圈心 1.5m 內就算）', () => {
    expect(RingPassJudge.crossed(at(0, 2, -3.6), at(0, 2, -3.7), c, 0, R)).toBe(false);
    expect(RingPassJudge.crossed(at(0.5, 2, -4.2), at(-0.5, 2, -4.2), c, 0, R)).toBe(false);
  });

  it('從圈外穿過圈面（旁邊、上面）：不算', () => {
    expect(RingPassJudge.crossed(at(1.6, 2, -4.9), at(1.6, 2, -5.1), c, 0, R)).toBe(false);
    expect(RingPassJudge.crossed(at(0, 3.6, -4.9), at(0, 3.6, -5.1), c, 0, R)).toBe(false);
  });

  it('沿著圈面側飛（擦過圈邊）：不算', () => {
    expect(RingPassJudge.crossed(at(-1, 2, -5), at(1, 2, -5), c, 0, R)).toBe(false);
  });

  it('圈轉 90°（面向左右）：要沿 X 穿過，沿 Z 飛過去不算', () => {
    const yaw90 = Math.PI / 2;
    expect(RingPassJudge.crossed(at(0.1, 2, -5), at(-0.1, 2, -5), c, yaw90, R)).toBe(true);
    expect(RingPassJudge.crossed(at(0, 2, -4.9), at(0, 2, -5.1), c, yaw90, R)).toBe(false);
  });

  it('停在圈面上再離開：只算一次', () => {
    const onPlane = at(0, 2, -5);
    const a = RingPassJudge.crossed(at(0, 2, -4.9), onPlane, c, 0, R);
    const b = RingPassJudge.crossed(onPlane, at(0, 2, -5.1), c, 0, R);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('瞬移（重置、載入）跨過圈面：不算', () => {
    expect(RingPassJudge.crossed(at(0, 2, 0), at(0, 2, -5 - RING_MAX_STEP_M), c, 0, R)).toBe(false);
  });

  it('自轉角度用絕對 tick：重播從任何 tick 開始算都一樣', () => {
    expect(RingPassJudge.yawRadAt(90, 0, 1234)).toBeCloseTo(Math.PI / 2, 12);
    expect(RingPassJudge.yawRadAt(0, 0.015, 100)).toBeCloseTo(1.5, 12);
  });
});
