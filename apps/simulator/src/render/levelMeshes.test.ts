// 穿圈引導：下一個圈高亮、已穿過與還沒輪到分開；1-4 / 1-5 不自轉。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NullEngine, Scene, StandardMaterial } from '@babylonjs/core';
import { RingGuide, ringSpin, type LevelDef } from '@creafly/shared';
import { bus } from '../core/events';
import { applyLoadLevel, levelState } from '../core/level';
import { simTime } from '../core/droneState';
import { LevelVisuals } from './levelMeshes';

const chapter1 = JSON.parse(
  readFileSync(join(__dirname, '../../public/levels/chapter1.json'), 'utf8'),
) as { levels: LevelDef[] };

function matOf(scene: Scene, name: string): StandardMaterial {
  const mesh = scene.getMeshByName(name);
  if (!mesh?.material) throw new Error(`找不到 ${name}`);
  return mesh.material as StandardMaterial;
}

function expectColor(mat: StandardMaterial, color: number): void {
  expect(mat.diffuseColor.r).toBeCloseTo(((color >> 16) & 255) / 255, 2);
  expect(mat.diffuseColor.g).toBeCloseTo(((color >> 8) & 255) / 255, 2);
  expect(mat.diffuseColor.b).toBeCloseTo((color & 255) / 255, 2);
}

describe('穿圈引導', () => {
  let scene: Scene;
  let visuals: LevelVisuals;

  beforeAll(() => {
    const g = globalThis as unknown as { window: typeof globalThis; document: Document; location: Location };
    g.window = globalThis;
    g.location = { search: '', protocol: 'http:', host: 'localhost' } as Location;
    g.document = {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
    } as unknown as Document;
    new NullEngine();
    scene = new Scene(new NullEngine());
    visuals = new LevelVisuals(scene);
    levelState.levels = chapter1.levels;
  });

  it('1-4、1-5 有圈且自轉為 0；第一章其他關沒有圈', () => {
    for (const level of chapter1.levels) {
      if (level.id === '1-4' || level.id === '1-5') {
        expect(level.rings?.length).toBe(3);
        for (const ring of level.rings ?? []) expect(ringSpin(ring)).toBe(0);
      } else {
        expect(level.rings ?? []).toEqual([]);
      }
    }
  });

  it('1-4 下一個圈是金色，後面的圈維持原本的紅色且比較淡', () => {
    applyLoadLevel('1-4');
    const next = RingGuide.look('next');
    const upcoming = RingGuide.look('upcoming');
    expectColor(matOf(scene, 'ring0'), next.color!);
    expect(matOf(scene, 'ring0').alpha).toBe(next.alpha);
    expectColor(matOf(scene, 'ring1'), 0xff4444);
    expect(matOf(scene, 'ring1').alpha).toBe(upcoming.alpha);
    expectColor(matOf(scene, 'ring2'), 0xff4444);
    expect(scene.getMeshByName('ring0')!.isEnabled()).toBe(true);
  });

  it('穿過第一圈後，它變灰、下一圈接手高亮，圈仍留在場上', () => {
    applyLoadLevel('1-4');
    levelState.rings[0]!.passed = true;
    bus.emit('ring-passed', { index: 0, collected: 1, total: 3 });
    expectColor(matOf(scene, 'ring0'), RingGuide.look('passed').color!);
    expect(matOf(scene, 'ring0').alpha).toBe(RingGuide.look('passed').alpha);
    expectColor(matOf(scene, 'ring1'), RingGuide.look('next').color!);
    expectColor(matOf(scene, 'ring2'), 0xff4444);
    expect(scene.getMeshByName('ring0')!.isEnabled()).toBe(true);
    expect(scene.getMeshByName('ring1')!.isEnabled()).toBe(true);
  });

  it('1-4 與 1-5 的圈 tick 後不自轉；沒寫 spin 的圈仍會轉', () => {
    applyLoadLevel('1-4');
    const still = scene.getTransformNodeByName('ringYaw0');
    expect(still).toBeTruthy();
    const y0 = still!.rotation.y;
    visuals.tick(0);
    visuals.tick(16);
    expect(still!.rotation.y).toBe(y0);

    applyLoadLevel('1-5');
    const yaw15 = scene.getTransformNodeByName('ringYaw1')!;
    visuals.tick(32);
    expect(yaw15.rotation.y).toBe(0);

    const custom: LevelDef = {
      id: 't-spin',
      name: '自轉對照',
      rings: [{ x: 0, y: 2, z: -4, color: 'blue' }],
    };
    levelState.levels = [...chapter1.levels, custom];
    applyLoadLevel('t-spin');
    const spinning = scene.getTransformNodeByName('ringYaw0')!;
    simTime.tick = 3;
    visuals.tick(48);
    expect(spinning.rotation.y).toBeCloseTo(ringSpin({}) * 3, 5);
    simTime.tick = 0;
    expectColor(matOf(scene, 'ring0'), RingGuide.look('next').color!);
  });

  it('旋轉鑽圈對準時，只有下一個圈變綠', () => {
    applyLoadLevel('1-5');
    bus.emit('ring-face', { index: 0, aligned: true });
    expectColor(matOf(scene, 'ring0'), RingGuide.look('next', true).color!);
    expectColor(matOf(scene, 'ring1'), 0xff4444);
    bus.emit('ring-face', { index: 0, aligned: false });
    expectColor(matOf(scene, 'ring0'), RingGuide.look('next').color!);
  });

  it('圈的擺放角度：和機頭 yaw 同一套；有自轉時從這個角度開始轉', () => {
    const custom: LevelDef = {
      id: 't-ring-yaw',
      name: '擺放角度',
      rings: [
        { x: 0, y: 2, z: -4, yaw: 90, spin: 0 },
        { x: 0, y: 2, z: -8, yaw: -45 },
      ],
    };
    levelState.levels = [...chapter1.levels, custom];
    applyLoadLevel('t-ring-yaw');
    const fixed = scene.getTransformNodeByName('ringYaw0')!;
    expect(fixed.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    visuals.tick(16);
    expect(fixed.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    const spinning = scene.getTransformNodeByName('ringYaw1')!;
    simTime.tick = 2;
    visuals.tick(32);
    expect(spinning.rotation.y).toBeCloseTo(-Math.PI / 4 + 2 * ringSpin({}), 6);
    simTime.tick = 0;
  });
});

describe('任務點標出下一步', () => {
  let scene: Scene;

  beforeAll(() => {
    scene = new Scene(new NullEngine());
    new LevelVisuals(scene);
    levelState.levels = chapter1.levels;
  });

  function disc(i: number) {
    const mesh = scene.getMeshByName(`zoneDisc${i}`);
    if (!mesh) throw new Error(`找不到 zoneDisc${i}`);
    return { mesh, mat: mesh.material as StandardMaterial };
  }

  function expectEmissive(mat: StandardMaterial, color: number): void {
    expect(mat.emissiveColor.r).toBeCloseTo(((color >> 16) & 255) / 255, 2);
    expect(mat.emissiveColor.g).toBeCloseTo(((color >> 8) & 255) / 255, 2);
    expect(mat.emissiveColor.b).toBeCloseTo((color & 255) / 255, 2);
  }

  it('1-2：第一步金色，同在原點的步驟 2、4 只顯示步驟 2', () => {
    applyLoadLevel('1-2');
    expectEmissive(disc(0).mat, RingGuide.look('next').color!);
    expect(disc(1).mesh.isEnabled()).toBe(true);
    expect(disc(3).mesh.isEnabled()).toBe(false);
  });

  it('做完前兩步：原點換顯示步驟 4，第 3 步變金色、做完的變灰', () => {
    applyLoadLevel('1-2');
    levelState.zoneProgress[0] = true;
    levelState.zoneProgress[1] = true;
    bus.emit('zone-passed', { index: 1, done: 2, total: 4 });
    expectEmissive(disc(0).mat, RingGuide.look('passed').color!);
    expectEmissive(disc(2).mat, RingGuide.look('next').color!);
    expect(disc(1).mesh.isEnabled()).toBe(false);
    expect(disc(3).mesh.isEnabled()).toBe(true);
    expect(disc(3).mat.alpha).toBe(0.4);
  });

  it('高度任務點設了觸發半徑：地面畫出觸發範圍；沒設的（任何位置都算）不畫', () => {
    const custom: LevelDef = {
      id: 't-trigger',
      name: '觸發範圍',
      passZones: [
        { type: 'altitude', x: 0, z: -2, label: '起飛', minY: 0.5 },
        { type: 'altitude', x: 0, z: -7, label: '在平台降落', maxY: 0.5, triggerRadius: 1.5 },
      ],
    };
    levelState.levels = [...chapter1.levels, custom];
    applyLoadLevel('t-trigger');
    expect(scene.getMeshByName('zoneDisc0')).toBeNull();
    expect(disc(1).mesh.isEnabled()).toBe(true);
  });
});

describe('擺放角度與障礙外觀', () => {
  let scene: Scene;

  beforeAll(() => {
    scene = new Scene(new NullEngine());
    new LevelVisuals(scene);
  });

  it('1-5 旋轉鑽圈：圈面對著要求的機頭方向（faceYaw），學生正面穿過', () => {
    levelState.levels = chapter1.levels;
    applyLoadLevel('1-5');
    const want = [270, 0, 90];
    want.forEach((deg, i) => {
      expect(scene.getTransformNodeByName(`ringYaw${i}`)!.rotation.y).toBeCloseTo((deg * Math.PI) / 180, 6);
    });
  });

  it('障礙外觀跟著實際碰撞：標記柱設成參與碰撞就畫成實心', () => {
    const custom: LevelDef = {
      id: 't-obs',
      name: '障礙',
      obstacles: [
        { type: 'soft-cube', x: 0, y: 1, z: -4, size: 1, physics: { collidable: true } },
        { type: 'soft-cube', x: 2, y: 1, z: -4, size: 1 },
      ],
    };
    levelState.levels = [...chapter1.levels, custom];
    applyLoadLevel('t-obs');
    expect((scene.getMeshByName('obstacle0')!.material as StandardMaterial).alpha).toBe(0.85);
    expect((scene.getMeshByName('obstacle1')!.material as StandardMaterial).alpha).toBe(0.6);
  });
});

