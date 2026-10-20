// 官方關卡判定回歸：以 public/levels 真實資料驗證「學生照教案飛」一定觸發。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HeadingZone, LevelDef } from '@creafly/shared';
import { HEADING_TOLERANCE_DEG, YawAccumulator } from '@creafly/shared';
import { bootstrapLevelForReplay, levelState, tickLevel } from './level';
import { droneState, HOME_POSITION } from './droneState';

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
    flyTo(rings[2]!.x, rings[2]!.y, rings[2]!.z);
    expect(levelState.rings[2]!.passed).toBe(false);
    flyTo(rings[0]!.x, rings[0]!.y, rings[0]!.z);
    expect(levelState.rings[0]!.passed).toBe(true);
    flyTo(rings[1]!.x, rings[1]!.y, rings[1]!.z);
    flyTo(rings[2]!.x, rings[2]!.y, rings[2]!.z);
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
    flyTo(rings[0]!.x, rings[0]!.y, rings[0]!.z);
    flyTo(rings[1]!.x, rings[1]!.y, rings[1]!.z);
    flyTo(rings[2]!.x, rings[2]!.y, rings[2]!.z);
    droneState.isGrounded = true;
    flyTo(2, HOME_POSITION.y, 0);
    expect(levelState.manualComplete).toBe(false);
  });
});
