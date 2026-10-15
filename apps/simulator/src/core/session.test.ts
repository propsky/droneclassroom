// 關卡／大亂鬥／足球兩兩互切：退出後不得留下場次狀態、計時器、碰撞或監聽器。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { obstacleIsCollidable, type LevelDef } from '@creafly/shared';
import { bus } from './events';
import { flags } from './droneState';
import {
  applyLoadLevel,
  armLevelStart,
  levelState,
} from './level';
import { pauseGame } from './pause';
import { meshCollisionActive, setMeshCollisionBackend, solidObstacleCount } from './physics';
import type { PhysicsBackend } from './physicsBackend';
import { programState, runProgram } from './program';
import { GameSession } from './session';
import { ARENA_OBSTACLE_DEFS, arenaState, enterArena, exitArena } from '../multiplayer/arena';
import { enterSoccerMatch, exitSoccerMatch, soccerState } from '../multiplayer/soccer';
import { enterSoccerPractice, exitSoccerPractice, practiceState } from '../soccer/practice';
import { wsState } from '../net/ws';

const levels: LevelDef[] = [1, 2, 3].flatMap((n) => {
  const data = JSON.parse(
    readFileSync(join(__dirname, `../../public/levels/chapter${n}.json`), 'utf8'),
  ) as { levels: LevelDef[] };
  return data.levels;
});

const LEVEL_IDS = levels.map((l) => l.id);
const MODES = [...LEVEL_IDS, 'arena', 'soccer-practice', 'soccer-match'] as const;
type ModeId = (typeof MODES)[number];

function isLevel(id: string): boolean {
  return LEVEL_IDS.includes(id);
}

function solidCountOf(level: LevelDef): number {
  return (level.obstacles ?? []).filter((o) => obstacleIsCollidable(o)).length;
}

/** 測試用 DOM：HUD 只查元素，沒有畫面也能進出場 */
function installDomStub(): void {
  if (typeof globalThis.document !== 'undefined') return;
  const g = globalThis as unknown as { document: Document; window: typeof globalThis };
  g.window = globalThis;
  g.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => undefined,
    createElement: () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} } }),
  } as unknown as Document;
}

function enterMode(id: ModeId): void {
  if (id === 'arena') enterArena();
  else if (id === 'soccer-practice') enterSoccerPractice();
  else if (id === 'soccer-match') enterSoccerMatch();
  else applyLoadLevel(id);
}

function leaveMode(id: ModeId): void {
  if (id === 'arena') exitArena();
  else if (id === 'soccer-practice') exitSoccerPractice();
  else if (id === 'soccer-match') exitSoccerMatch();
  else if (GameSession.active === 'level') GameSession.exit('level');
}

function resetAll(): void {
  if (arenaState.active) exitArena();
  if (practiceState.active) exitSoccerPractice();
  if (soccerState.active) exitSoccerMatch();
  if (GameSession.active === 'level') GameSession.exit('level');
  if (GameSession.active !== 'idle') {
    GameSession.exit(GameSession.active);
  }
  setMeshCollisionBackend(null);
}

function expectOnly(id: ModeId, probe: Set<string>): void {
  expect(meshCollisionActive()).toBe(false);
  expect(flags.multiplayerLock).toBe(false);
  expect(flags.countdownActive).toBe(false);
  expect(flags.paused).toBe(false);
  expect(programState.running).toBe(false);

  if (id === 'arena') {
    expect(GameSession.active).toBe('arena');
    expect(arenaState.active).toBe(true);
    expect(practiceState.active).toBe(false);
    expect(soccerState.active).toBe(false);
    expect(levelState.current).toBeNull();
    expect(solidObstacleCount()).toBe(ARENA_OBSTACLE_DEFS.length);
    expect(GameSession.liveTimerCount()).toBe(1);
    expect(probe).toEqual(new Set(['arena:scene']));
    return;
  }
  if (id === 'soccer-practice' || id === 'soccer-match') {
    expect(GameSession.active).toBe(id);
    expect(arenaState.active).toBe(false);
    expect(arenaState.balloons.size).toBe(0);
    expect(arenaState.others.size).toBe(0);
    expect(practiceState.active).toBe(id === 'soccer-practice');
    expect(soccerState.active).toBe(id === 'soccer-match');
    expect(levelState.current).toBeNull();
    expect(solidObstacleCount()).toBe(0);
    expect(GameSession.liveTimerCount()).toBe(id === 'soccer-match' ? 1 : 0);
    expect(probe).toEqual(new Set(['soccer:field']));
    return;
  }
  const level = levels.find((l) => l.id === id);
  expect(level).toBeTruthy();
  expect(GameSession.active).toBe('level');
  expect(arenaState.active).toBe(false);
  expect(arenaState.balloons.size).toBe(0);
  expect(arenaState.pendingPop.size).toBe(0);
  expect(arenaState.others.size).toBe(0);
  expect(practiceState.active).toBe(false);
  expect(soccerState.active).toBe(false);
  expect(levelState.current?.id).toBe(id);
  expect(levelState.armed).toBe(false);
  expect(levelState.startTime).toBe(0);
  expect(levelState.ringsCollected).toBe(0);
  expect(levelState.balloonsCollected).toBe(0);
  expect(solidObstacleCount()).toBe(solidCountOf(level!));
  expect(GameSession.liveTimerCount()).toBe(0);
  expect(probe).toEqual(new Set([`level:${id}`]));
}

describe('場次生命週期', () => {
  const probe = new Set<string>();

  beforeAll(() => {
    installDomStub();
    wsState.stopped = true;
    levelState.levels = levels;
    const drop = (prefix: string): void => {
      for (const key of [...probe]) if (key.startsWith(prefix)) probe.delete(key);
    };
    // 與 render 訂閱同一組事件：關卡物件、大亂鬥場景、足球場地
    bus.on('level-loaded', ({ level }) => {
      drop('level:');
      probe.add(`level:${level.id}`);
    });
    bus.on('level-cleared', () => drop('level:'));
    bus.on('arena-entered', () => probe.add('arena:scene'));
    bus.on('arena-exited', () => drop('arena:'));
    bus.on('soccer-entered', () => probe.add('soccer:field'));
    bus.on('soccer-exited', () => drop('soccer:'));
  });

  afterEach(() => {
    resetAll();
    probe.clear();
    expect(GameSession.active).toBe('idle');
    expect(GameSession.liveTimerCount()).toBe(0);
  });

  it('官方關卡、大亂鬥、足球練習、足球對戰兩兩互切（含切回同一場）', () => {
    const handlersBefore = bus.handlerCount();
    for (const src of MODES) {
      for (const dest of MODES) {
        resetAll();
        probe.clear();
        enterMode(src);
        if (src === 'arena') {
          arenaState.balloons.set(7, { x: 1, y: 2, z: 3 });
          arenaState.pendingPop.add(7);
          arenaState.others.set('p2', {
            name: '乙',
            emoji: '🐱',
            role: 'runner',
            stunned: false,
            invincible: false,
            target: { x: 2, y: 1, z: 2, yaw: 0 },
          });
        }
        if (src === dest && !isLevel(src)) {
          // 切回同一個接管型模式：先完整退出再進入
          leaveMode(src);
          expect(GameSession.liveTimerCount()).toBe(0);
          expect(arenaState.active).toBe(false);
          expect(practiceState.active).toBe(false);
          expect(soccerState.active).toBe(false);
          expect(probe.size).toBe(0);
        }
        enterMode(dest);
        expectOnly(dest, probe);
      }
    }
    expect(bus.handlerCount()).toBe(handlersBefore);
  });

  it('大亂鬥切到其他關卡會退出氣球賽局，倒數計時器不會啟動新關', () => {
    vi.useFakeTimers();
    try {
      enterArena();
      expect(GameSession.liveTimerCount('arena')).toBe(1);
      applyLoadLevel('1-1');
      armLevelStart();
      expect(flags.countdownActive).toBe(true);
      expect(GameSession.liveTimerCount('level')).toBe(1);
      const seen: number[] = [];
      const off = bus.on('countdown', ({ n }) => seen.push(n));
      applyLoadLevel('1-4');
      vi.advanceTimersByTime(5000);
      off();
      expect(seen).toEqual([]);
      expect(levelState.current?.id).toBe('1-4');
      expect(levelState.startTime).toBe(0);
      expect(flags.countdownActive).toBe(false);
      expect(arenaState.active).toBe(false);
      expect(GameSession.liveTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('切關會拆掉暫停與進行中的程式，不會用舊程式判定新關過關', async () => {
    applyLoadLevel('1-4');
    levelState.armed = true;
    levelState.startTime = Date.now();
    pauseGame();
    expect(flags.paused).toBe(true);
    runProgram('await CREAFLY.takeoff(3);');
    expect(programState.running).toBe(true);
    applyLoadLevel('1-1');
    expect(flags.paused).toBe(false);
    expect(programState.running).toBe(false);
    expect(levelState.current?.id).toBe('1-1');
    expect(levelState.manualComplete).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(levelState.current?.id).toBe('1-1');
    expect(levelState.manualComplete).toBe(false);
    expect(programState.running).toBe(false);
  });

  it('離場會卸下網格碰撞，自由練習沒有關卡倒數', () => {
    const backend = {
      init: () => Promise.resolve(),
      resolveCollisions: (pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }) => ({
        pos,
        vel,
        bumped: false,
      }),
      addStaticBox() {},
      addStaticMesh() {},
      removeStatic() {},
      clear() {},
    } satisfies PhysicsBackend;
    enterArena();
    setMeshCollisionBackend(backend);
    expect(meshCollisionActive()).toBe(true);
    enterSoccerPractice();
    expect(meshCollisionActive()).toBe(false);
    expect(arenaState.active).toBe(false);
    expect(practiceState.count).toBe(0);
    expect(GameSession.liveTimerCount('soccer-practice')).toBe(0);
    applyLoadLevel('2-1');
    expect(practiceState.active).toBe(false);
    expect(levelState.current?.id).toBe('2-1');
    expect(GameSession.liveTimerCount()).toBe(0);
    expect(meshCollisionActive()).toBe(false);
  });
});
