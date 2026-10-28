import { describe, expect, it } from 'vitest';
import {
  LEVEL_KIT_SNIPPETS,
  applyLevelKitSnippet,
  extractLevelKitPatch,
  getLevelKitSnippet,
  inferLevelKitCategory,
  levelKitApplyMode,
  levelKitByCategory,
  validateAllLevelKitSnippets,
  validateLevelKitPatch,
  validateLevelKitSnippet,
} from './levelKit';
import type { LevelDef, AltitudeZone } from './levels';

const blank: LevelDef = {
  id: 'cl-1',
  name: '測試',
  rings: [],
  obstacles: [],
  passZones: [],
};

describe('levelKit', () => {
  it('所有素材 id 唯一', () => {
    const ids = LEVEL_KIT_SNIPPETS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('所有素材通過驗證', () => {
    const failures = validateAllLevelKitSnippets();
    expect(failures).toEqual([]);
  });

  it('每個素材可合併到空白關卡', () => {
    for (const snip of LEVEL_KIT_SNIPPETS) {
      const out = applyLevelKitSnippet(blank, snip, 'replace-tasks');
      expect(out.id).toBe('cl-1');
      expect(validateLevelKitSnippet(snip)).toEqual([]);
    }
  });

  it('append 穿圈素材', () => {
    const snip = getLevelKitSnippet('rings-line-3');
    expect(snip).toBeDefined();
    const out = applyLevelKitSnippet(blank, snip!);
    expect(out.rings).toHaveLength(3);
    expect(out.returnHome).toBe(true);
  });

  it('replace-tasks 覆寫 passZones', () => {
    const oldZone: AltitudeZone = { x: 0, z: 0, label: '舊', type: 'altitude', minY: 1 };
    const withZones: LevelDef = { ...blank, passZones: [oldZone] };
    const snip = getLevelKitSnippet('task-altitude');
    const out = applyLevelKitSnippet(withZones, snip!, 'replace-tasks');
    expect(out.passZones).toHaveLength(4);
    expect(out.passZones?.[0]?.label).toBe('起飛 ≥ 0.5m');
  });

  it('完整情境 forceIntro 覆寫 intro', () => {
    const withIntro: LevelDef = { ...blank, intro: '舊說明' };
    const snip = getLevelKitSnippet('scene-face-rings-full');
    expect(snip?.forceIntro).toBe(true);
    const out = applyLevelKitSnippet(withIntro, snip!, 'append');
    expect(out.intro).toContain('機頭對準');
    expect(out.rings).toHaveLength(3);
  });

  it('draw 3D 素材帶 orbit', () => {
    const snip = getLevelKitSnippet('draw-spiral-3d');
    const out = applyLevelKitSnippet(blank, snip!, 'replace-tasks');
    expect(out.draw).toBe(true);
    expect(out.view).toBe('orbit3d');
    expect(out.orbit?.radius).toBe(13);
  });

  it('六類都有範本（數量不求多，重複的由「沒有重複的範本」測試擋下）', () => {
    for (const c of ['rings', 'obstacles', 'tasks', 'scenes', 'draw', 'races'] as const) {
      expect(levelKitByCategory(c).length, c).toBeGreaterThan(0);
    }
  });

  it('extractLevelKitPatch 可抽出圈與障礙', () => {
    const level: LevelDef = {
      id: 'cl-1',
      name: '測試',
      rings: [{ x: 0, y: 2.5, z: -4, label: '1' }],
      obstacles: [{ type: 'cube', solid: true, x: 2, y: 1, z: -3, size: 1 }],
      hud: '提示',
    };
    const patch = extractLevelKitPatch(level, { includeMeta: true });
    expect(patch.rings?.length).toBe(1);
    expect(patch.obstacles?.length).toBe(1);
    expect(patch.hud).toBe('提示');
    expect(validateLevelKitPatch(patch)).toEqual([]);
  });

  it('inferLevelKitCategory 依內容推測分類', () => {
    expect(inferLevelKitCategory({ draw: true, view: 'topdown' })).toBe('draw');
    expect(inferLevelKitCategory({ passZones: [{ type: 'position', x: 0, z: 0, label: 'a' }] })).toBe('tasks');
    expect(inferLevelKitCategory({ rings: [{ x: 0, y: 2, z: -3 }] })).toBe('rings');
  });
});

describe('範本照自己的說明做得出來', () => {
  it('畫六邊形：照「前進 4m、右轉 60°」重複 6 次，會依序經過每個角', () => {
    const snip = getLevelKitSnippet('draw-hexagon')!;
    const zones = snip.patch.passZones!;
    // 模擬烏龜繪圖：機頭朝 -Z、右轉為負 yaw
    const path: [number, number][] = [[0, 0]];
    let yaw = 0;
    for (let i = 0; i < 6; i++) {
      const [x, z] = path[path.length - 1]!;
      path.push([x - Math.sin(yaw) * 4, z - Math.cos(yaw) * 4]);
      yaw -= Math.PI / 3;
    }
    let next = 0;
    for (const [x, z] of path) {
      const zone = zones[next];
      if (zone?.type !== 'position') continue;
      if (x >= zone.minX! && x <= zone.maxX! && z >= zone.minZ! && z <= zone.maxZ!) next++;
    }
    expect(next).toBe(zones.length);
    const guide = snip.patch.guide!;
    path.forEach(([x, z], i) => {
      expect(guide[i]![0]).toBeCloseTo(x, 1);
      expect(guide[i]![1]).toBeCloseTo(z, 1);
    });
  });

  it('8 字繞圈：依序穿、不自轉，每個圈面對沿路線飛的方向', () => {
    const snip = getLevelKitSnippet('rings-figure8')!;
    expect(snip.patch.ringOrder).toBe('sequential');
    const rings = snip.patch.rings!;
    // 左圈逆時針、右圈順時針：沿切線方向的機頭角
    const tangent = (cx: number, x: number, z: number, ccw: boolean): number => {
      const rx = x - cx;
      const rz = z - -6;
      const fx = ccw ? rz : -rz;
      const fz = ccw ? -rx : rx;
      return Math.round((Math.atan2(-fx, -fz) * 180) / Math.PI);
    };
    rings.forEach((r, i) => {
      expect(r.spin).toBe(0);
      const want = i < 3 ? tangent(-3, r.x, r.z, true) : tangent(3, r.x, r.z, false);
      expect(((r.yaw! - want) % 360 + 360) % 360).toBe(0);
    });
  });

  it('寫了「依序」的穿圈範本都真的要求依序', () => {
    for (const s of LEVEL_KIT_SNIPPETS) {
      const text = `${s.patch.hud ?? ''}${s.patch.intro ?? ''}`;
      if (s.patch.rings?.length && /依序穿/.test(text)) expect(s.patch.ringOrder, s.id).toBe('sequential');
    }
  });

  it('取代任務模式：素材寫 passZones: [] 會清掉原本的任務', () => {
    const level = { id: 't', name: 't', passZones: [{ type: 'altitude' as const, x: 0, z: 0, label: '舊', minY: 1 }] };
    const out = applyLevelKitSnippet(level, getLevelKitSnippet('draw-free')!, 'replace-tasks');
    expect(out.passZones).toEqual([]);
    const kept = applyLevelKitSnippet(level, getLevelKitSnippet('draw-free')!, 'append');
    expect(kept.passZones).toHaveLength(1);
  });

  it('依序穿圈跟著素材存取，不會在儲存範本時遺失', () => {
    const level = { id: 't', name: 't', ringOrder: 'sequential' as const, rings: [{ x: 0, y: 2, z: -4 }] };
    const patch = extractLevelKitPatch(level);
    expect(patch.ringOrder).toBe('sequential');
    const out = applyLevelKitSnippet({ id: 'u', name: 'u' }, { id: 'k', category: 'rings', name: 'k', desc: '', patch });
    expect(out.ringOrder).toBe('sequential');
  });

  it('套用模式：任務、畫畫、競速取代任務；其他疊加', () => {
    expect(levelKitApplyMode({ category: 'tasks' })).toBe('replace-tasks');
    expect(levelKitApplyMode({ category: 'draw' })).toBe('replace-tasks');
    expect(levelKitApplyMode({ category: 'races' })).toBe('replace-tasks');
    expect(levelKitApplyMode({ category: 'rings' })).toBe('append');
    expect(levelKitApplyMode({ category: 'scenes' })).toBe('append');
  });
});

describe('範本的判定位置正確，不會誤判', () => {
  const positionZones = LEVEL_KIT_SNIPPETS.flatMap((s) =>
    (s.patch.passZones ?? []).filter((z) => z.type === 'position').map((z) => ({ id: s.id, z })),
  );

  it('每個位置任務點都是封閉的框，而且地面標記就在框裡（不會半個場地都算）', () => {
    expect(positionZones.length).toBeGreaterThan(20);
    for (const { id, z } of positionZones) {
      if (z.type !== 'position') continue;
      const tag = `${id}/${z.label}`;
      for (const k of ['minX', 'maxX', 'minZ', 'maxZ'] as const) expect(z[k], tag).toBeTypeOf('number');
      expect(z.x, tag).toBeGreaterThanOrEqual(z.minX!);
      expect(z.x, tag).toBeLessThanOrEqual(z.maxX!);
      expect(z.z, tag).toBeGreaterThanOrEqual(z.minZ!);
      expect(z.z, tag).toBeLessThanOrEqual(z.maxZ!);
    }
  });

  it('門框：檢查框夾在兩根柱子中間、柱子高度，從旁邊或上面繞過去不算', () => {
    for (const id of ['obs-gate', 'obs-narrow-2m', 'scene-gate-rings', 'race-gate-sprint', 'scene-rally-pro']) {
      const p = getLevelKitSnippet(id)!.patch;
      const gates = (p.passZones ?? []).filter((z) => z.label.startsWith('門框'));
      expect(gates.length, id).toBe((p.obstacles ?? []).length / 2);
      for (const g of gates) {
        if (g.type !== 'position') throw new Error(id);
        const posts = p.obstacles!.filter((o) => Math.abs(o.z - g.z) < 0.01);
        expect(posts, id).toHaveLength(2);
        const [l, r] = posts.sort((a, b) => a.x - b.x);
        expect(g.minX, id).toBeCloseTo(l!.x + l!.size / 2);
        expect(g.maxX, id).toBeCloseTo(r!.x - r!.size / 2);
        expect(g.minY, id).toBeCloseTo(l!.y - l!.size / 2);
        expect(g.maxY, id).toBeCloseTo(l!.y + l!.size / 2);
      }
    }
  });

  it('繞柱：檢查框在每根柱子的外側，直線穿過中間不算', () => {
    for (const id of ['obs-slalom', 'race-slalom-mix']) {
      const p = getLevelKitSnippet(id)!.patch;
      const poles = p.obstacles!;
      const checks = p.passZones!.filter((z) => z.label.startsWith('繞柱'));
      expect(checks, id).toHaveLength(poles.length);
      checks.forEach((c, i) => {
        if (c.type !== 'position') throw new Error(id);
        const pole = poles[i]!;
        const outer = Math.sign(pole.x);
        expect(Math.sign(c.x), id).toBe(outer);
        // 中線 x=0 不在框裡
        expect(0 < c.minX! || 0 > c.maxX!, id).toBe(true);
        // 框不和柱子重疊
        expect(outer > 0 ? c.minX! >= pole.x + pole.size / 2 : c.maxX! <= pole.x - pole.size / 2, id).toBe(true);
      });
    }
  });

  it('沒有重複的範本：每個範本的物件組合都不一樣', () => {
    const sig = (s: (typeof LEVEL_KIT_SNIPPETS)[number]) =>
      JSON.stringify([
        (s.patch.rings ?? []).map((r) => [r.x, r.y, r.z]),
        (s.patch.obstacles ?? []).map((o) => [o.x, o.y, o.z, o.size]),
        (s.patch.balloons ?? []).map((b) => [b.x, b.y, b.z]),
        (s.patch.passZones ?? []).map((z) => [z.type, z.x, z.z]),
      ]);
    const seen = new Map<string, string>();
    for (const s of LEVEL_KIT_SNIPPETS) {
      if (s.id === 'draw-free' || s.id === 'draw-free-3d') continue;
      const k = sig(s);
      expect(seen.get(k), `${s.id} 和 ${seen.get(k)} 重複`).toBeUndefined();
      seen.set(k, s.id);
    }
    // 純障礙範本之間不能一樣（情境範本可以沿用同一個門框）
    const obstacleSets = LEVEL_KIT_SNIPPETS.filter((s) => s.category === 'obstacles').map((s) => [
      s.id,
      JSON.stringify(s.patch.obstacles!.map((o) => [o.x, o.y, o.z, o.size])),
    ]);
    const bySet = new Map<string, string>();
    for (const [id, k] of obstacleSets) {
      expect(bySet.get(k!), `${id} 和 ${bySet.get(k!)} 障礙相同`).toBeUndefined();
      bySet.set(k!, id!);
    }
  });
});
