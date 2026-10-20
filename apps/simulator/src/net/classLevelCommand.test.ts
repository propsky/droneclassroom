// 老師全班傳送：一般關卡、足球、大亂鬥都要真的切場次。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LevelDef } from '@creafly/shared';
import { flags } from '../core/droneState';
import { applyLoadLevel, levelState } from '../core/level';
import { GameSession } from '../core/session';
import { arenaState, enterArena, exitArena } from '../multiplayer/arena';
import { enterSoccerMatch, exitSoccerMatch, soccerState } from '../multiplayer/soccer';
import { enterSoccerPractice, exitSoccerPractice, practiceState } from '../soccer/practice';
import { ClassLevelCommand } from './classLevelCommand';
import { loadLevel } from './levelLoad';
import { ingestServerMessage, wsState } from './ws';

const levels: LevelDef[] = [1, 2, 3].flatMap((n) => {
  const data = JSON.parse(
    readFileSync(join(__dirname, `../../public/levels/chapter${n}.json`), 'utf8'),
  ) as { levels: LevelDef[] };
  return data.levels;
});

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

function resetModes(): void {
  if (arenaState.active) exitArena();
  if (practiceState.active) exitSoccerPractice();
  if (soccerState.active) exitSoccerMatch();
  if (GameSession.active === 'level') GameSession.exit('level');
  if (GameSession.active !== 'idle') GameSession.exit(GameSession.active);
}

describe('學生端全班傳送', () => {
  beforeAll(() => {
    installDomStub();
    wsState.stopped = true;
    levelState.levels = levels;
    ClassLevelCommand.bind({
      exitTransient: () => GameSession.exitTransient(),
      loadChapter: (levelId) => {
        void loadLevel(levelId, { bypassGuard: true });
      },
      enterSoccerPractice,
      enterSoccerMatch,
      enterArena: (mode, field) => enterArena({ mode, field }),
      chapterTitle: (levelId) => levelState.levels.find((l) => l.id === levelId)?.name ?? null,
    });
  });

  afterEach(() => {
    resetModes();
    levelState.levels = levels;
    vi.restoreAllMocks();
  });

  it('在大亂鬥、足球對戰、足球練習時載入一般關卡會切回該關', async () => {
    enterArena();
    ingestServerMessage({ type: 'load_level', levelId: '1-4' });
    await vi.waitFor(() => expect(levelState.current?.id).toBe('1-4'));
    expect(arenaState.active).toBe(false);
    expect(GameSession.active).toBe('level');

    enterSoccerMatch();
    ingestServerMessage({ type: 'load_level', levelId: '2-1' });
    await vi.waitFor(() => expect(levelState.current?.id).toBe('2-1'));
    expect(soccerState.active).toBe(false);
    expect(practiceState.active).toBe(false);

    enterSoccerPractice();
    ingestServerMessage({ type: 'load_level', levelId: '3-2' });
    await vi.waitFor(() => expect(levelState.current?.id).toBe('3-2'));
    expect(practiceState.active).toBe(false);
    expect(GameSession.active).toBe('level');
  });

  it('活動 id 會切進足球練習、足球對戰與大亂鬥場地', () => {
    applyLoadLevel('1-1');
    ingestServerMessage({ type: 'load_level', levelId: 'activity:soccer-practice' });
    expect(practiceState.active).toBe(true);
    expect(GameSession.active).toBe('soccer-practice');
    expect(levelState.current).toBeNull();

    ingestServerMessage({ type: 'load_level', levelId: 'soccer-match' });
    expect(soccerState.active).toBe(true);
    expect(practiceState.active).toBe(false);
    expect(GameSession.active).toBe('soccer-match');

    ingestServerMessage({ type: 'load_level', levelId: 'activity:arena:tag:playground' });
    expect(arenaState.active).toBe(true);
    expect(soccerState.active).toBe(false);
    expect(arenaState.mode).toBe('tag');
    expect(arenaState.field).toBe('playground');
    expect(GameSession.active).toBe('arena');
  });

  it('人已在大亂鬥時改傳另一種大亂鬥只切模式與場地', () => {
    enterArena();
    expect(arenaState.mode).toBe('balloon');
    expect(arenaState.field).toBe('grid');
    ingestServerMessage({ type: 'load_level', levelId: 'activity:arena:balloon:playground' });
    expect(arenaState.active).toBe(true);
    expect(arenaState.mode).toBe('balloon');
    expect(arenaState.field).toBe('playground');
  });

  it('關卡清單還沒到時活動仍立刻進場，一般關卡先暫存', () => {
    levelState.levels = [];
    enterSoccerPractice();
    ingestServerMessage({ type: 'load_level', levelId: 'activity:soccer-match' });
    expect(soccerState.active).toBe(true);
    expect(practiceState.active).toBe(false);

    enterArena();
    ingestServerMessage({ type: 'load_level', levelId: '1-2' });
    expect(arenaState.active).toBe(true);
    expect(GameSession.active).toBe('arena');
  });

  it('記憶體沒有的自訂關卡也會先離開賽局', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    enterArena();
    ingestServerMessage({ type: 'load_level', levelId: 'cl-9' });
    expect(arenaState.active).toBe(false);
    expect(GameSession.active).not.toBe('arena');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it('比賽開始若選到活動，改切畫面而不當章節計時賽', () => {
    applyLoadLevel('1-4');
    ingestServerMessage({ type: 'race_start', levelId: 'activity:arena:balloon:grid' });
    expect(arenaState.active).toBe(true);
    expect(arenaState.mode).toBe('balloon');
    expect(arenaState.field).toBe('grid');
    expect(flags.countdownActive).toBe(false);
    expect(levelState.current).toBeNull();
  });
});
