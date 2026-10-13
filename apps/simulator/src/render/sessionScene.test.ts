// 真實 mesh：大亂鬥氣球／掩體與關卡物件在互切後必須 dispose，帳本歸零。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NullEngine, Scene } from '@babylonjs/core';
import type { LevelDef } from '@creafly/shared';
import { applyLoadLevel, levelState } from '../core/level';
import { SceneLedger } from '../core/sceneLedger';
import { GameSession } from '../core/session';
import { arenaState, enterArena, exitArena } from '../multiplayer/arena';
import { wsState } from '../net/ws';
import { ArenaCloneVisuals } from './clones';
import { GuideVisual } from './guide';
import { InkVisual } from './ink';
import { LevelVisuals } from './levelMeshes';
import { PlaygroundScene } from './playground';
import type { DroneVisual } from './drone';

const levels: LevelDef[] = [1, 2, 3].flatMap((n) => {
  const data = JSON.parse(
    readFileSync(join(__dirname, `../../public/levels/chapter${n}.json`), 'utf8'),
  ) as { levels: LevelDef[] };
  return data.levels;
});

const drawLevel: LevelDef = {
  id: 't-draw',
  name: '畫線',
  draw: true,
  guide: [
    [0, 0],
    [2, 0],
    [2, 2],
  ],
  rings: [],
};

function names(scene: Scene, prefix: string): string[] {
  return scene.meshes.filter((m) => m.name.startsWith(prefix)).map((m) => m.name);
}

function materialNames(scene: Scene, prefix: string): string[] {
  return scene.materials.filter((m) => (m.name ?? '').startsWith(prefix)).map((m) => m.name);
}

describe('場景卸載', () => {
  let engine: NullEngine;
  let scene: Scene;
  let clones: ArenaCloneVisuals;

  beforeAll(() => {
    const g = globalThis as unknown as { window: typeof globalThis; document: Document; location: Location };
    g.window = globalThis;
    g.location = { search: '', protocol: 'http:', host: 'localhost' } as Location;
    g.document = {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
    } as unknown as Document;
    wsState.stopped = true;
    engine = new NullEngine();
    scene = new Scene(engine);
    const drone = {
      setScaleFactor() {},
      setOpacityFactor() {},
      setForceHidden() {},
      setVisible() {},
    } as unknown as DroneVisual;
    new LevelVisuals(scene);
    new GuideVisual(scene);
    new InkVisual(scene);
    new PlaygroundScene(scene);
    clones = new ArenaCloneVisuals(scene, drone);
    levelState.levels = [...levels, drawLevel];
  });

  afterEach(() => {
    if (arenaState.active) exitArena();
    if (GameSession.active === 'level') GameSession.exit('level');
    SceneLedger.set('level', 0);
    SceneLedger.set('arena', 0);
    SceneLedger.set('guide', 0);
    SceneLedger.set('playground', 0);
  });

  it('大亂鬥氣球與掩體在切到其他關卡後全部 dispose', () => {
    applyLoadLevel('1-6');
    expect(names(scene, 'balloon').length).toBeGreaterThan(0);
    expect(SceneLedger.count('level')).toBeGreaterThan(0);

    enterArena();
    expect(names(scene, 'balloon')).toEqual([]);
    expect(names(scene, 'ring')).toEqual([]);
    expect(names(scene, 'arenaObstacle').length).toBe(8);
    expect(SceneLedger.count('level')).toBe(0);
    expect(SceneLedger.count('arena')).toBe(8);

    arenaState.balloons.set(3, { x: 1, y: 2, z: -4 });
    arenaState.balloons.set(4, { x: -2, y: 3, z: 1 });
    clones.tick();
    expect(names(scene, 'arenaBalloon').sort()).toEqual(['arenaBalloon-3', 'arenaBalloon-4']);
    expect(materialNames(scene, 'arenaBalloonMat').length).toBe(2);
    expect(SceneLedger.count('arena')).toBeGreaterThanOrEqual(10);

    applyLoadLevel('1-4');
    expect(arenaState.active).toBe(false);
    expect(names(scene, 'arena')).toEqual([]);
    expect(materialNames(scene, 'arena')).toEqual([]);
    expect(SceneLedger.count('arena')).toBe(0);
    expect(names(scene, 'ring').length).toBe(3);
    expect(SceneLedger.count('level')).toBeGreaterThan(0);
    expect(levelState.current?.id).toBe('1-4');
  });

  it('關卡互切與切回同一關不會留下上一關的 mesh', () => {
    applyLoadLevel('1-4');
    const once = names(scene, 'ring').length;
    expect(once).toBe(3);
    applyLoadLevel('1-4');
    expect(names(scene, 'ring').length).toBe(once);
    applyLoadLevel('1-1');
    expect(names(scene, 'ring')).toEqual([]);
    expect(names(scene, 'balloon')).toEqual([]);
    applyLoadLevel('t-draw');
    expect(names(scene, 'guideLine')).toEqual(['guideLine']);
    expect(SceneLedger.count('guide')).toBe(1);
    enterArena();
    expect(names(scene, 'guideLine')).toEqual([]);
    expect(SceneLedger.count('guide')).toBe(0);
    expect(SceneLedger.count('level')).toBe(0);
    exitArena();
    expect(names(scene, 'arena')).toEqual([]);
    expect(SceneLedger.count('arena')).toBe(0);
    expect(SceneLedger.total()).toBe(0);
  });
});
