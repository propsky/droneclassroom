import { describe, expect, it } from 'vitest';
import { parseImportedLevel } from './levelIo';

describe('parseImportedLevel', () => {
  it('強制使用目前關卡的 id 與標題', () => {
    const def = parseImportedLevel(
      { id: 'old-id', name: '舊名稱', intro: '說明', rings: [{ x: 1, y: 2, z: 3 }] },
      'cl-abc',
      '新標題',
    );
    expect(def.id).toBe('cl-abc');
    expect(def.name).toBe('舊名稱');
    expect(def.intro).toBe('說明');
    expect(def.rings).toHaveLength(1);
    expect(def.returnHome).toBe(true);
  });

  it('空白欄位使用預設值', () => {
    const def = parseImportedLevel({}, 'cl-x', '期中考');
    expect(def.name).toBe('期中考');
    expect(def.hud).toBe('期中考');
    expect(def.rings).toEqual([]);
    expect(def.obstacles).toEqual([]);
    expect(def.passZones).toEqual([]);
    expect(def.balloons).toEqual([]);
    expect(def.freeplay).toBe(false);
  });

  it('保留 guide 等擴充欄位', () => {
    const def = parseImportedLevel(
      { guide: [[1, 2], [3, 4]], drawHeight: 3 },
      'cl-draw',
      '畫畫',
    );
    expect(def.guide).toEqual([[1, 2], [3, 4]]);
    expect(def.drawHeight).toBe(3);
  });
});
