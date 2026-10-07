// 官方關卡判定回歸：以 public/levels 真實資料驗證「學生照教案飛」一定觸發。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LevelDef } from '@creafly/shared';
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

  it('1-3 在起飛台原地轉 90° 觸發第一步', () => {
    load('1-3');
    droneState.yaw = Math.PI / 2;
    flyTo(HOME_POSITION.x, 1.5, HOME_POSITION.z);
    expect(levelState.zoneProgress[0]).toBe(true);
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
