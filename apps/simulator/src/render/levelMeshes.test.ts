// 穿圈引導：下一個圈高亮、已穿過與還沒輪到分開；1-4 / 1-5 不自轉。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NullEngine, Scene, StandardMaterial } from '@babylonjs/core';
import { RingGuide, ringSpin, type LevelDef } from '@creafly/shared';
import { bus } from '../core/events';
import { applyLoadLevel, levelState } from '../core/level';
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
    visuals.tick(48);
    expect(spinning.rotation.y).toBeCloseTo(ringSpin({}), 5);
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
});
