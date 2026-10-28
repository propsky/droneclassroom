// 官方關卡判定回歸：以 public/levels 真實資料驗證「學生照教案飛」一定觸發。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HeadingZone, LevelDef } from '@creafly/shared';
import { HEADING_TOLERANCE_DEG, YawAccumulator, ringYawDeg, type RingDef } from '@creafly/shared';
import { bootstrapLevelForReplay, levelState, tickLevel } from './level';
import { droneState, HOME_POSITION } from './droneState';
import { bus } from './events';

const chapter1 = JSON.parse(
  readFileSync(join(__dirname, '../../public/levels/chapter1.json'), 'utf-8'),
) as LevelDef[] | { levels: LevelDef[] };
const levels = Array.isArray(chapter1) ? chapter1 : chapter1.levels;

function load(id: string): LevelDef {
  const level = levels.find((l) => l.id === id);
  if (!level) throw new Error(`找不到關卡 ${id}`);
  bootstrapLevelForReplay(level);
  return level;
}

function flyTo(x: number, y: number, z: number): void {
  droneState.position.x = x;
  droneState.position.y = y;
  droneState.position.z = z;
  tickLevel(0);
}

/** 沿圈面法線從圈前 1m 飛到圈後 1m（每 tick 0.25m），真的從圈裡穿過去。 */
function passRing(r: RingDef, dx = 0, dy = 0): void {
  const yaw = (ringYawDeg(r) * Math.PI) / 180;
  const nx = -Math.sin(yaw);
  const nz = -Math.cos(yaw);
  for (let step = -4; step <= 4; step++) {
    const d = step * 0.25;
    flyTo(r.x + dx + nx * d, r.y + dy, r.z + nz * d);
  }
}

function holdYaw(deg: number): void {
  droneState.yaw = (deg * Math.PI) / 180;
  tickLevel(0);
  tickLevel(0);
}

/** 每 tick 轉 step 度，中途不停。 */
function sweepYaw(toDeg: number, step: number): void {
  for (let deg = step; deg <= toDeg + 1e-9; deg += step) {
    droneState.yaw = (deg * Math.PI) / 180;
    tickLevel(0);
  }
}

function HeadingJudgeTarget(all: LevelDef[], id: string): number {
  const level = all.find((l) => l.id === id);
  const last = level?.passZones?.at(-1) as HeadingZone | undefined;
  return last?.targetYaw ?? NaN;
}

function yawLevel(target: number, tolerance = HEADING_TOLERANCE_DEG): LevelDef {
  return {
    id: 't-yaw',
    name: '轉角',
    passZones: [
      {
        x: 0,
        z: 0,
        label: '轉角',
        type: 'heading',
        targetYaw: target,
        tolerance,
        yawMode: 'accumulated',
      },
    ],
  };
}

describe('官方關卡判定（起飛台原地操作）', () => {
  it.each(['1-0', '1-1'])('%s 在起飛台原地升到 1m 觸發「起飛」', (id) => {
    load(id);
    flyTo(HOME_POSITION.x, 1, HOME_POSITION.z);
    expect(levelState.zoneProgress[0]).toBe(true);
  });

  it('1-1 原地升降完成全部高度步驟', () => {
    load('1-1');
    for (const y of [1, 3, 1.2, 0.4]) flyTo(HOME_POSITION.x, y, HOME_POSITION.z);
    expect(levelState.zoneProgress.every(Boolean)).toBe(true);
  });

  it('1-3 要先起飛，再停在累積 90°，掃過或轉一整圈都不算', () => {
    load('1-3');
    holdYaw(90);
    expect(levelState.zoneProgress[0]).toBe(false);
    expect(levelState.zoneProgress[1]).toBe(false);
    droneState.yaw = 0;
    tickLevel(0);
    flyTo(HOME_POSITION.x, 1.5, HOME_POSITION.z);
    expect(levelState.zoneProgress[0]).toBe(true);
    expect(levelState.zoneProgress[1]).toBe(false);
    sweepYaw(360, 15);
    expect(levelState.zoneProgress[1]).toBe(false);
    holdYaw(90);
    expect(levelState.zoneProgress[1]).toBe(true);
    holdYaw(360);
    expect(levelState.zoneProgress[1]).toBe(true);
    expect(levelState.zoneProgress.every(Boolean)).toBe(false);
    holdYaw(450);
    expect(levelState.zoneProgress[1]).toBe(true);
    expect(HeadingJudgeTarget(levels, '1-3')).toBe(360);
  });

  it('自訂 triggerRadius 時仍限制水平位置', () => {
    const level = load('1-0');
    bootstrapLevelForReplay({
      ...level,
      passZones: level.passZones!.map((z) => ({ ...z, triggerRadius: 1 })),
    });
    flyTo(HOME_POSITION.x, 1, HOME_POSITION.z);
    expect(levelState.zoneProgress[0]).toBe(false);
  });

  it('1-6 氣球中心距 1.2m 戳破（legacy 1.4m 內）', () => {
    const level = load('1-6');
    const b = level.balloons![0]!;
    flyTo(b.x + 1.2, b.y, b.z);
    expect(levelState.balloons[0]!.popped).toBe(true);
  });
});

describe('旋轉、距離、高度、降落、順序', () => {
  it('90° 關：剛好、容差內、剛超出、360°、450°、反方向', () => {
    const run = (deg: number): boolean => {
      bootstrapLevelForReplay(yawLevel(90));
      holdYaw(deg);
      return levelState.zoneProgress[0] === true;
    };
    expect(run(90)).toBe(true);
    expect(run(80)).toBe(true);
    expect(run(100)).toBe(true);
    expect(run(79.9)).toBe(false);
    expect(run(100.1)).toBe(false);
    expect(run(360)).toBe(false);
    expect(run(450)).toBe(false);
    expect(run(-90)).toBe(false);
  });

  it('一路轉過 90° 到 360° 不算，停在 90° 才算', () => {
    bootstrapLevelForReplay(yawLevel(90));
    sweepYaw(360, 15);
    expect(levelState.zoneProgress[0]).toBe(false);
    holdYaw(90);
    expect(levelState.zoneProgress[0]).toBe(true);
  });

  it('小增量跨過 ±180 後停在 230°，不會被折成別的角', () => {
    const total = YawAccumulator.sum([170, 20, 20, 20]);
    expect(total).toBe(230);
    bootstrapLevelForReplay(yawLevel(230));
    holdYaw(total);
    expect(levelState.zoneProgress[0]).toBe(true);
    bootstrapLevelForReplay(yawLevel(230));
    holdYaw(total - 360);
    expect(levelState.zoneProgress[0]).toBe(false);
    bootstrapLevelForReplay(yawLevel(90));
    holdYaw(total);
    expect(levelState.zoneProgress[0]).toBe(false);
  });

  it('1-2 前 3m 有上下限，且必須照順序', () => {
    load('1-2');
    flyTo(3, 2, 0);
    expect(levelState.zoneProgress[0]).toBe(false);
    flyTo(0, 2, -2.49);
    expect(levelState.zoneProgress[0]).toBe(false);
    flyTo(0, 2, -3.51);
    expect(levelState.zoneProgress[0]).toBe(false);
    flyTo(0.81, 2, -3);
    expect(levelState.zoneProgress[0]).toBe(false);
    flyTo(0, 1.19, -3);
    expect(levelState.zoneProgress[0]).toBe(false);
    flyTo(0, 3.01, -3);
    expect(levelState.zoneProgress[0]).toBe(false);
    flyTo(0, 2, -3);
    expect(levelState.zoneProgress[0]).toBe(true);
    expect(levelState.zoneProgress[1]).toBe(false);
    flyTo(0, 2, 0);
    expect(levelState.zoneProgress[1]).toBe(true);
    flyTo(3, 2, 0);
    expect(levelState.zoneProgress[2]).toBe(true);
    flyTo(0, 2.5, 0);
    expect(levelState.zoneProgress.every(Boolean)).toBe(true);
  });

  it('1-1 落地高度含 0.5m、超過就不算', () => {
    load('1-1');
    for (const y of [1, 3, 1.2]) flyTo(HOME_POSITION.x, y, HOME_POSITION.z);
    flyTo(HOME_POSITION.x, 0.51, HOME_POSITION.z);
    expect(levelState.zoneProgress[3]).toBe(false);
    flyTo(HOME_POSITION.x, 0.5, HOME_POSITION.z);
    expect(levelState.zoneProgress.every(Boolean)).toBe(true);
  });

  it('1-4 必須依序穿圈，回墊但沒著地不算完成', () => {
    const level = load('1-4');
    const rings = level.rings!;
    passRing(rings[2]!);
    expect(levelState.rings[2]!.passed).toBe(false);
    passRing(rings[0]!);
    expect(levelState.rings[0]!.passed).toBe(true);
    passRing(rings[1]!);
    passRing(rings[2]!);
    expect(levelState.rings.every((r) => r.passed)).toBe(true);
    droneState.isGrounded = false;
    droneState.isFlying = true;
    flyTo(HOME_POSITION.x, 2, HOME_POSITION.z);
    expect(levelState.manualComplete).toBe(false);
    droneState.isGrounded = true;
    droneState.isFlying = false;
    flyTo(HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z);
    expect(levelState.manualComplete).toBe(true);
    bootstrapLevelForReplay(level);
    passRing(rings[0]!);
    passRing(rings[1]!);
    passRing(rings[2]!);
    droneState.isGrounded = true;
    flyTo(2, HOME_POSITION.y, 0);
    expect(levelState.manualComplete).toBe(false);
  });
});

describe('整關過關：出現的任務全部做完才算，只上報一次', () => {
  /** 關卡編輯器做得出來的混合關：2 個圈 + 2 個任務點 + 1 顆氣球 */
  function mixed(returnHome: boolean): LevelDef {
    return {
      id: 't-mixed',
      name: '混合',
      returnHome,
      rings: [
        { x: 0, y: 2, z: -5, spin: 0, bobAmp: 0 },
        { x: 0, y: 2, z: -10, spin: 0, bobAmp: 0 },
      ],
      passZones: [
        { type: 'position', x: 5, z: -10, label: '步驟 1', minX: 4, maxX: 6, minZ: -11, maxZ: -9 },
        { type: 'position', x: 5, z: -5, label: '步驟 2', minX: 4, maxX: 6, minZ: -6, maxZ: -4 },
      ],
      balloons: [{ x: -5, y: 2, z: -5 }],
    };
  }

  function countReports(run: () => void): number {
    let n = 0;
    const off = bus.on('level-complete', () => n++);
    run();
    off();
    return n;
  }

  function land(): void {
    droneState.isGrounded = true;
    flyTo(HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z);
  }

  it('只做完任務點、沒穿圈：不算過關（範本「綜合拉力賽」原本會直接過）', () => {
    bootstrapLevelForReplay(mixed(false));
    droneState.isGrounded = false;
    const reports = countReports(() => {
      flyTo(5, 2, -10);
      flyTo(5, 2, -5);
      flyTo(-5, 2, -5);
    });
    expect(levelState.zoneProgress.every(Boolean)).toBe(true);
    expect(levelState.balloonsCollected).toBe(1);
    expect(levelState.manualComplete).toBe(false);
    expect(reports).toBe(0);
  });

  it('全部做完才過關，而且只上報一次', () => {
    bootstrapLevelForReplay(mixed(false));
    droneState.isGrounded = false;
    const reports = countReports(() => {
      passRing({ x: 0, y: 2, z: -5 });
      passRing({ x: 0, y: 2, z: -10 });
      flyTo(5, 2, -10);
      flyTo(5, 2, -5);
      expect(levelState.manualComplete).toBe(false);
      flyTo(-5, 2, -5);
      flyTo(-5, 2, -5);
      flyTo(0, 3, 0);
    });
    expect(levelState.manualComplete).toBe(true);
    expect(reports).toBe(1);
  });

  it('勾了返航：任務點關也要降落在起飛墊才過關', () => {
    const level: LevelDef = { ...mixed(true), rings: [], balloons: [] };
    bootstrapLevelForReplay(level);
    droneState.isGrounded = false;
    const reports = countReports(() => {
      flyTo(5, 2, -10);
      flyTo(5, 2, -5);
      expect(levelState.awaitingReturn).toBe(true);
      flyTo(HOME_POSITION.x, 2, HOME_POSITION.z);
      expect(levelState.manualComplete).toBe(false);
      land();
    });
    expect(levelState.manualComplete).toBe(true);
    expect(reports).toBe(1);
  });

  it('沒勾返航的任務點關：最後一步完成當下就過關（官方 1-1～3-3 不變）', () => {
    load('1-2');
    const reports = countReports(() => {
      for (const zone of levelState.current!.passZones!) {
        if (zone.type !== 'position') continue;
        const x = ((zone.minX ?? zone.x) + (zone.maxX ?? zone.x)) / 2;
        const z = ((zone.minZ ?? zone.z) + (zone.maxZ ?? zone.z)) / 2;
        const y = ((zone.minY ?? 1.5) + (zone.maxY ?? 1.5)) / 2;
        flyTo(x, y, z);
      }
    });
    expect(levelState.zoneProgress.every(Boolean)).toBe(true);
    expect(levelState.manualComplete).toBe(true);
    expect(reports).toBe(1);
  });
});


describe('穿圈要從圈裡穿過去，不會誤判', () => {
  function ringLevel(rings: RingDef[]): LevelDef {
    return { id: 't-ring', name: '穿圈', ringOrder: 'sequential', rings };
  }

  it('飛到圈前面停住、在圈前面晃：不算（舊判定離圈心 1.5m 內就算）', () => {
    bootstrapLevelForReplay(ringLevel([{ x: 0, y: 2, z: -5, spin: 0, bobAmp: 0 }]));
    for (const z of [-3.6, -3.8, -4, -3.7, -3.9]) flyTo(0, 2, z);
    expect(levelState.rings[0]!.passed).toBe(false);
  });

  it('從圈的外面（旁邊、上方）穿過圈面：不算', () => {
    const ring: RingDef = { x: 0, y: 2, z: -5, spin: 0, bobAmp: 0 };
    bootstrapLevelForReplay(ringLevel([ring]));
    passRing(ring, 1.6);
    passRing(ring, 0, 1.6);
    expect(levelState.rings[0]!.passed).toBe(false);
    passRing(ring, 0.5, -0.5);
    expect(levelState.rings[0]!.passed).toBe(true);
  });

  it('側著的圈（擺放角度 90°）：要從側面穿；沿前後方向擦過去不算', () => {
    const ring: RingDef = { x: 0, y: 2, z: -5, yaw: 90, spin: 0, bobAmp: 0 };
    bootstrapLevelForReplay(ringLevel([ring]));
    passRing({ ...ring, yaw: 0 });
    expect(levelState.rings[0]!.passed).toBe(false);
    passRing(ring);
    expect(levelState.rings[0]!.passed).toBe(true);
  });

  it('8 字範本照路線飛：六個圈依序都算、最後返航過關', async () => {
    const { getLevelKitSnippet } = await import('@creafly/shared');
    const patch = getLevelKitSnippet('rings-figure8')!.patch;
    bootstrapLevelForReplay({ id: 't-8', name: '8', ...patch } as LevelDef);
    droneState.isGrounded = false;
    for (const r of patch.rings!) passRing(r);
    expect(levelState.rings.every((r) => r.passed)).toBe(true);
    droneState.isGrounded = true;
    flyTo(HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z);
    expect(levelState.manualComplete).toBe(true);
  });

  it('官方 1-5：照說明從正確方向穿三個紅圈都算', () => {
    const level = load('1-5');
    for (const [i, r] of level.rings!.entries()) {
      holdYaw(r.faceYaw!);
      passRing(r);
      expect(levelState.rings[i]!.passed).toBe(true);
    }
  });
});

describe('門框與繞柱：從正確的位置過才算', () => {
  async function sprint(): Promise<LevelDef> {
    const { getLevelKitSnippet } = await import('@creafly/shared');
    return { id: 't-sprint', name: '門框衝刺', ...getLevelKitSnippet('race-gate-sprint')!.patch } as LevelDef;
  }

  function flyLine(x: number, y: number, fromZ: number, toZ: number): void {
    const step = fromZ > toZ ? -0.25 : 0.25;
    for (let z = fromZ; step < 0 ? z >= toZ : z <= toZ; z += step) flyTo(x, y, z);
  }

  it('從門框上方飛過去：門框不算，穿了終點圈也不過關', async () => {
    const level = await sprint();
    bootstrapLevelForReplay(level);
    droneState.isGrounded = false;
    flyLine(0, 2.5, 0, -15);
    expect(levelState.rings[0]!.passed).toBe(true);
    expect(levelState.zoneProgress.some(Boolean)).toBe(false);
    droneState.isGrounded = true;
    flyTo(HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z);
    expect(levelState.manualComplete).toBe(false);
  });

  it('從三道門中間（柱子高度）穿過、再穿終點圈、返航：過關', async () => {
    const level = await sprint();
    bootstrapLevelForReplay(level);
    droneState.isGrounded = false;
    flyLine(0, 1.5, 0, -12.75);
    expect(levelState.zoneProgress.every(Boolean)).toBe(true);
    for (let y = 1.5; y <= 2.5; y += 0.25) flyTo(0, y, -13);
    flyLine(0, 2.5, -13, -15);
    droneState.isGrounded = true;
    flyTo(HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z);
    expect(levelState.manualComplete).toBe(true);
  });
});
